(() => {
  'use strict';

  const STATES = Object.freeze({
    IDLE: 'IDLE', HABILITADO: 'HABILITADO', PIEZA_EN_CINTA: 'PIEZA_EN_CINTA',
    INSPECCION: 'INSPECCION', DESCARTE: 'DESCARTE',
    MECANIZANDO_AVANCE: 'MECANIZANDO_AVANCE', MECANIZANDO_RETROCESO: 'MECANIZANDO_RETROCESO',
    ALMACENANDO: 'ALMACENANDO', CICLO_COMPLETO: 'CICLO_COMPLETO', EMERGENCIA: 'EMERGENCIA'
  });

  const timings = Object.freeze({ conveyorTime: 3000, inspectionTime: 1500, pressAdvanceTime: 2000, pressReturnTime: 1500, storageTime: 1000 });
  const startedAt = Date.now();
  let state = STATES.IDLE;
  let pieceType = 'METAL';
  let automatic = true;
  let cycleTimer = null;
  let siloLevel = 0;
  let counters = { metal: 0, plastic: 0, cycles: 0 };
  let signals = makeIdleSignals();

  const $ = (id) => document.getElementById(id);
  const ui = {
    start: $('startBtn'), stop: $('stopBtn'), reset: $('resetBtn'), estop: $('estopBtn'),
    mode: $('modeSwitch'), modeLabel: $('modeLabel'), discharge: $('dischargeBtn'),
    selector: $('pieceSelector'), log: $('eventLog'), clearLog: $('clearLogBtn'),
    state: $('cycleState'), hmi: $('hmiScreen'), hmiText: $('hmiText'), hmiSubtext: $('hmiSubtext'), svgHmi: $('svgHmi'),
    headerLamp: $('headerLamp'), headerStatus: $('headerStatus'), overlay: $('emergencyOverlay'),
    plant: $('plantSvg'), part: $('movingPart'), drill: $('drillHead'), pusher: $('pusher'), gate: $('gate'),
    level: $('hopperLevel'), levelSensor: $('levelSensor'), fullLabel: $('fullLabel'), opticalBeam: $('opticalBeam'),
    metalCount: $('metalCount'), plasticCount: $('plasticCount'), cycleCount: $('cycleCount'),
    levelValue: $('levelValue'), levelBar: $('levelBar'), siloMessage: $('siloMessage'), siloPanel: document.querySelector('.silo-panel'),
    signalList: $('signalList'), ladder: $('ladderDiagram')
  };

  const signalMeta = [
    ['K1', 'K1', 'Relé maestro T1'], ['K1_T4', 'K1 · T4', 'Relé cinta ingreso'], ['K3', 'K3', 'Pusher clasificación'],
    ['IFM', 'IFM', 'Barrera óptica'], ['B1_ind', 'B1 IND', 'Detección metal'], ['B1_cap', 'B1 CAP', 'Nivel máximo tolva'],
    ['B2_cap', 'B2 CAP', 'Detección plástico'], ['B2_tapa', 'B2 TAPA', 'Interlock cerrado'],
    ['FC1', 'FC1', 'Prensa en reposo'], ['FC2', 'FC2', 'Prensa abajo'], ['H1', 'H1', 'Sistema / metal OK'], ['H2', 'H2', 'Parada / descarte']
  ];

  const rungs = [
    { n: 1, contacts: [['S0', 'NC'], ['S2', 'NO'], ['K1', 'NO']], coil: 'K1', active: () => signals.K1 },
    { n: 2, contacts: [['K1', 'NO'], ['IFM', 'NO']], coil: 'K1_T4', active: () => signals.K1_T4 && signals.IFM },
    { n: 3, contacts: [['K1_T4', 'NO'], ['B1 IND', 'NO']], coil: 'K1 METAL + H1', active: () => signals.B1_ind },
    { n: 4, contacts: [['K1_T4', 'NO'], ['B1 IND', 'NC']], coil: 'K3 + H2', active: () => signals.K3 },
    { n: 5, contacts: [['K1 METAL', 'NO'], ['FC1', 'NC']], coil: 'T3 AVANCE', active: () => state === STATES.MECANIZANDO_AVANCE },
    { n: 6, contacts: [['AVANCE', 'NO'], ['FC2', 'NO']], coil: 'T3 RETROCESO', active: () => state === STATES.MECANIZANDO_RETROCESO },
    { n: 7, contacts: [['RETROCESO', 'NO'], ['FC1', 'NO']], coil: 'T5 HABILIT.', active: () => state === STATES.ALMACENANDO || state === STATES.CICLO_COMPLETO },
    { n: 8, contacts: [['T5 HAB.', 'NO'], ['B2 TAPA', 'NO'], ['B1 NIVEL', 'NC']], coil: 'K2 COMPUERTA', active: () => signals.K2 }
  ];

  function makeIdleSignals() {
    return { K1: false, K1_T4: false, K3: false, K2: false, IFM: false, B1_ind: false, B1_cap: false, B2_cap: false, B2_tapa: true, FC1: true, FC2: false, H1: false, H2: true };
  }

  function elapsed() {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function log(message, tone = '') {
    const item = document.createElement('li');
    item.className = tone;
    item.innerHTML = `<b>${elapsed()}</b>${message}`;
    ui.log.prepend(item);
    while (ui.log.children.length > 50) ui.log.lastElementChild.remove();
  }

  // A single cycle timer owns every transition. It is always cancelled before replacement.
  function schedule(fn, delay) {
    clearTimeout(cycleTimer);
    cycleTimer = setTimeout(fn, delay);
  }

  function cancelCycleTimer() {
    clearTimeout(cycleTimer);
    cycleTimer = null;
  }

  function setState(next, message, tone = '') {
    state = next;
    if (message) log(message, tone);
    render();
  }

  function setMovingPart(visible, x = 0, y = 0, duration = 0) {
    ui.part.style.transition = duration ? `transform ${duration}ms linear` : 'none';
    ui.part.classList.toggle('hidden', !visible);
    ui.part.style.transform = `translate(${x}px, ${y}px)`;
  }

  function animatePart(from, to, duration) {
    setMovingPart(true, from.x, from.y, 0);
    requestAnimationFrame(() => requestAnimationFrame(() => setMovingPart(true, to.x, to.y, duration)));
  }

  // IDLE → HABILITADO. S2 is momentary; K1 remains latched until STOP/E-STOP.
  function startSystem() {
    if (state === STATES.EMERGENCIA) return log('START inhibido: resetee la emergencia.', 'danger');
    if (signals.K1) return log('K1 ya está enclavado; la línea continúa activa.', 'warn');
    if (siloLevel >= 100) return log('Arranque bloqueado: T5 informa LEVEL FULL.', 'danger');
    signals = makeIdleSignals();
    signals.K1 = true; signals.H1 = true; signals.H2 = false;
    setState(STATES.HABILITADO, 'S2 pulsado · K1 enclavado · línea habilitada.', 'ok');
    ui.start.classList.add('pressed');
    setTimeout(() => ui.start.classList.remove('pressed'), 200);
    schedule(beginConveyor, 500);
  }

  // HABILITADO → PIEZA_EN_CINTA: T4 receives +24 V through T1-X4/T4-X3.
  function beginConveyor() {
    if (!signals.K1 || state === STATES.EMERGENCIA) return;
    if (siloLevel >= 100) {
      setState(STATES.HABILITADO, 'T5 lleno: alimentación de nuevas piezas bloqueada.', 'danger');
      return;
    }
    signals.K1_T4 = true; signals.IFM = true;
    signals.B1_ind = false; signals.B2_cap = false; signals.K3 = false; signals.K2 = false;
    setState(STATES.PIEZA_EN_CINTA, `T4 detecta pieza ${pieceType} · barrera IFM interrumpida.`, 'ok');
    animatePart({ x: 315, y: 274 }, { x: 635, y: 274 }, timings.conveyorTime);
    schedule(beginInspection, timings.conveyorTime);
  }

  // PIEZA_EN_CINTA → INSPECCION: B1 validates metal; B2 identifies dielectric material.
  function beginInspection() {
    signals.IFM = false;
    signals.B1_ind = pieceType === 'METAL';
    signals.B2_cap = pieceType === 'PLASTICO';
    signals.H1 = signals.B1_ind;
    signals.H2 = signals.B2_cap;
    setState(STATES.INSPECCION, `T2 inspeccionando · B1=${signals.B1_ind ? 'ON' : 'OFF'} · B2=${signals.B2_cap ? 'ON' : 'OFF'}.`);
    setMovingPart(true, 700, 274, 500);
    schedule(classifyPiece, timings.inspectionTime);
  }

  function classifyPiece() {
    if (signals.B1_ind) approveMetal(); else discardPlastic();
  }

  // Plastic branch: K3 extends and the workpiece never energizes T3/T5.
  function discardPlastic() {
    signals.K3 = true; signals.H2 = true;
    setState(STATES.DESCARTE, 'PLÁSTICO detectado · K3 expulsa a bandeja de descarte.', 'warn');
    ui.pusher.classList.add('extended');
    setMovingPart(true, 770, 325, 650);
    schedule(() => {
      counters.plastic += 1; counters.cycles += 1;
      signals.K3 = false; signals.B2_cap = false;
      ui.pusher.classList.remove('extended'); setMovingPart(false);
      finishCycle('Ciclo de descarte finalizado; T3 y T5 no energizados.');
    }, 850);
  }

  // Metal branch: material-valid output T2-X5 energizes the T3 advance relay chain.
  function approveMetal() {
    signals.H1 = true; signals.H2 = false; signals.FC1 = false;
    setState(STATES.MECANIZANDO_AVANCE, 'METAL válido · T3 avanza el cabezal hasta FC2.', 'ok');
    animatePart({ x: 700, y: 274 }, { x: 985, y: 284 }, 750);
    ui.drill.classList.add('down');
    schedule(beginReturn, timings.pressAdvanceTime);
  }

  // FC2 changes over the bistable chain and commands return until FC1.
  function beginReturn() {
    signals.FC2 = true;
    setState(STATES.MECANIZANDO_RETROCESO, 'FC2 activo · mecanizado completo · retroceso ordenado.', 'ok');
    ui.drill.classList.remove('down');
    schedule(beginStorage, timings.pressReturnTime);
  }

  function beginStorage() {
    signals.FC2 = false; signals.FC1 = true; signals.K2 = automatic;
    setState(STATES.ALMACENANDO, automatic ? 'T3-X6 habilita T5 · K2 abre en automático.' : 'T5 habilitada · esperando apertura manual de K2.', automatic ? 'ok' : 'warn');
    animatePart({ x: 985, y: 284 }, { x: 1190, y: 205 }, 750);
    if (automatic) {
      ui.gate.classList.add('open');
      schedule(storeMetal, timings.storageTime);
    }
  }

  function storeMetal() {
    if (state !== STATES.ALMACENANDO) return;
    signals.K2 = false; ui.gate.classList.remove('open'); setMovingPart(false);
    siloLevel = Math.min(100, siloLevel + 25);
    signals.B1_cap = siloLevel >= 100;
    counters.metal += 1; counters.cycles += 1;
    const note = signals.B1_cap ? 'Tolva al 100% · B1 nivel activo · próximo ciclo bloqueado.' : `Metal almacenado · nivel de tolva ${siloLevel}%.`;
    finishCycle(note, signals.B1_cap ? 'danger' : 'ok');
  }

  function finishCycle(message, tone = 'ok') {
    signals.IFM = false; signals.K1_T4 = false; signals.B1_ind = false; signals.B2_cap = false;
    setState(STATES.CICLO_COMPLETO, message, tone);
    schedule(() => {
      if (!signals.K1 || state === STATES.EMERGENCIA) return;
      setState(STATES.HABILITADO, signals.B1_cap ? 'Línea en espera por nivel máximo T5.' : 'Ciclo rearmado · línea lista para siguiente pieza.', signals.B1_cap ? 'warn' : 'ok');
      if (!signals.B1_cap) schedule(beginConveyor, 1200);
    }, 900);
  }

  function stopSystem(source = 'S1 STOP pulsado · autorretención K1 liberada.') {
    if (state === STATES.EMERGENCIA) return;
    cancelCycleTimer();
    signals = makeIdleSignals();
    setMovingPart(false); ui.drill.classList.remove('down'); ui.pusher.classList.remove('extended'); ui.gate.classList.remove('open');
    setState(STATES.IDLE, source, 'warn');
  }

  function emergencyStop() {
    cancelCycleTimer();
    signals = makeIdleSignals(); signals.H2 = true; signals.B2_tapa = false;
    setMovingPart(false); ui.drill.classList.remove('down'); ui.pusher.classList.remove('extended'); ui.gate.classList.remove('open');
    setState(STATES.EMERGENCIA, 'S0 ACTIVADO · parada de categoría 0 · salidas desenergizadas.', 'danger');
  }

  function resetSystem() {
    if (state !== STATES.EMERGENCIA) return log('RESET ignorado: no hay emergencia activa.', 'warn');
    signals = makeIdleSignals();
    setState(STATES.IDLE, 'S0 liberado · sistema rearmado en IDLE.', 'ok');
  }

  function manualDischarge() {
    if (automatic) return;
    if (state === STATES.ALMACENANDO) {
      signals.K2 = true; ui.gate.classList.add('open'); render();
      schedule(storeMetal, timings.storageTime);
      return;
    }
    if (signals.K1) return log('Detenga la línea para vaciar la tolva manualmente.', 'warn');
    if (siloLevel === 0) return log('La tolva ya está vacía.');
    ui.gate.classList.add('open');
    log('K2 manual activo · descargando tolva.', 'warn');
    schedule(() => {
      siloLevel = 0; signals.B1_cap = false; ui.gate.classList.remove('open');
      log('Descarga manual completa · B1 nivel liberado.', 'ok'); render();
    }, 900);
  }

  function renderSignals() {
    signalMeta.forEach(([key]) => {
      const row = document.querySelector(`[data-signal="${key}"]`);
      if (!row) return;
      row.classList.toggle('active', Boolean(signals[key]));
      row.querySelector('b').textContent = signals[key] ? 'ON' : 'OFF';
    });
  }

  function renderLadder() {
    rungs.forEach((rung) => {
      const row = document.querySelector(`[data-rung="${rung.n}"]`);
      if (row) row.classList.toggle('active', rung.active());
    });
  }

  function render() {
    const emergency = state === STATES.EMERGENCIA;
    const running = signals.K1;
    ui.state.textContent = state;
    ui.headerLamp.className = `status-dot${emergency ? ' emergency' : running ? ' on' : ''}`;
    ui.headerStatus.textContent = emergency ? 'PARADA DE EMERGENCIA' : running ? 'PLANTA EN SERVICIO' : 'PLANTA DETENIDA';
    ui.overlay.classList.toggle('show', emergency); ui.overlay.setAttribute('aria-hidden', String(!emergency));
    ui.hmi.classList.toggle('emergency', emergency);
    ui.hmiText.textContent = emergency ? 'EMERGENCY' : running ? 'SYSTEM OK' : 'STANDBY';
    ui.hmiSubtext.textContent = emergency ? 'S0 activo · reset requerido' : signals.B1_cap ? 'T5 lleno · línea bloqueada' : running ? 'K1 enclavado · 24 VCC' : 'Esperando habilitación';
    ui.svgHmi.textContent = emergency ? 'E-STOP' : running ? 'SYSTEM OK' : 'STANDBY';
    ui.plant.classList.toggle('plant-running', running); ui.plant.classList.toggle('plant-warning', state === STATES.DESCARTE || signals.B1_cap); ui.plant.classList.toggle('plant-emergency', emergency);

    ['stationT1', 'stationT4', 'stationT2', 'stationT3', 'stationT5'].forEach((id) => $(id).classList.remove('active'));
    if (running) $('stationT1').classList.add('active');
    if ([STATES.PIEZA_EN_CINTA].includes(state)) $('stationT4').classList.add('active');
    if ([STATES.INSPECCION, STATES.DESCARTE].includes(state)) $('stationT2').classList.add('active');
    if ([STATES.MECANIZANDO_AVANCE, STATES.MECANIZANDO_RETROCESO].includes(state)) $('stationT3').classList.add('active');
    if ([STATES.ALMACENANDO, STATES.CICLO_COMPLETO].includes(state)) $('stationT5').classList.add('active');

    $('lampH1').classList.toggle('active', signals.H1); $('lampH2').classList.toggle('active', signals.H2);
    $('sortGreen').classList.toggle('active', signals.B1_ind); $('sortYellow').classList.toggle('active', signals.B2_cap || signals.K3);
    $('fc1').classList.toggle('active', signals.FC1); $('fc2').classList.toggle('active', signals.FC2);
    document.querySelectorAll('.station-power').forEach((lamp) => lamp.classList.toggle('active', signals.K1_T4));
    document.querySelectorAll('.belt').forEach((belt) => belt.classList.toggle('running', signals.K1_T4));
    ui.opticalBeam.classList.toggle('broken', signals.IFM);

    const wireActive = [signals.K1, signals.K1_T4 && signals.IFM, signals.B1_ind, state === STATES.ALMACENANDO || state === STATES.CICLO_COMPLETO];
    wireActive.forEach((active, index) => $(`wire${index + 1}`).classList.toggle('active', active));

    const levelHeight = Math.round(110 * siloLevel / 100);
    ui.level.setAttribute('y', String(177 - levelHeight)); ui.level.setAttribute('height', String(levelHeight));
    ui.levelSensor.classList.toggle('active', signals.B1_cap); ui.fullLabel.classList.toggle('active', signals.B1_cap);
    ui.fullLabel.textContent = signals.B1_cap ? 'LEVEL FULL' : 'LEVEL OK';
    ui.levelValue.textContent = `${siloLevel}%`; ui.levelBar.style.width = `${siloLevel}%`;
    ui.siloPanel.classList.toggle('full', signals.B1_cap);
    ui.siloMessage.textContent = signals.B1_cap ? 'Ciclo bloqueado · descargue T5' : 'Capacidad disponible';

    ui.metalCount.textContent = counters.metal; ui.plasticCount.textContent = counters.plastic; ui.cycleCount.textContent = counters.cycles;
    ui.start.disabled = emergency || running || signals.B1_cap; ui.stop.disabled = emergency || !running;
    ui.reset.disabled = !emergency;
    ui.discharge.disabled = automatic || (state !== STATES.ALMACENANDO && siloLevel === 0);
    renderSignals(); renderLadder();
  }

  function initializePanels() {
    ui.signalList.innerHTML = signalMeta.map(([key, label, description]) => `<div class="signal-item${key === 'B1_cap' ? ' danger' : ''}" data-signal="${key}"><i></i><span>${label}<small style="display:block;color:#63758c;font-size:7px">${description}</small></span><b>OFF</b></div>`).join('');
    ui.ladder.innerHTML = rungs.map((rung) => `<div class="rung" data-rung="${rung.n}"><span class="rung-no">R${rung.n}</span>${rung.contacts.map(([label, type]) => `<span class="contact ${type === 'NC' ? 'nc' : ''}"><span class="symbol">—| |—</span>${label} (${type})</span>`).join('<span class="wire-fill"></span>')}<span class="wire-fill"></span><span class="coil"><span class="symbol">—( )—</span>${rung.coil}</span></div>`).join('');
  }

  ui.start.addEventListener('click', startSystem);
  ui.stop.addEventListener('click', () => stopSystem());
  ui.estop.addEventListener('click', emergencyStop);
  ui.reset.addEventListener('click', resetSystem);
  ui.discharge.addEventListener('click', manualDischarge);
  ui.clearLog.addEventListener('click', () => { ui.log.innerHTML = ''; log('Registro de eventos reiniciado.'); });
  ui.selector.addEventListener('click', (event) => {
    const button = event.target.closest('[data-piece]'); if (!button) return;
    pieceType = button.dataset.piece;
    ui.selector.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
    log(`Selector de pieza ajustado a ${pieceType}.`);
  });
  ui.mode.addEventListener('change', () => {
    automatic = ui.mode.checked; ui.modeLabel.textContent = automatic ? 'MODO AUTOMÁTICO' : 'MODO MANUAL';
    log(`T5 configurada en modo ${automatic ? 'AUTOMÁTICO' : 'MANUAL'}.`, 'warn'); render();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') emergencyStop();
    if (event.key.toLowerCase() === 's' && !event.repeat) startSystem();
  });

  initializePanels();
  log('Simulador inicializado · 0V común verificado.', 'ok');
  log('Planta en IDLE · pulse START para enclavar K1.');
  render();
})();
