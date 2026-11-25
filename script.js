(() => {
  'use strict';

  /* =================================================================
     MOTOR PLC — ciclo fijo de 20 ms (acumulador determinista)
     =================================================================
     Un PLC real ejecuta su programa en un ciclo fijo (típicamente
     10-50 ms). El navegador NO garantiza esa cadencia — rAF corre
     a ~16.67 ms (60 Hz) o mucho menos si la pestaña pierde foco.

     Este motor acumula el tiempo real transcurrido y ejecuta la
     cantidad exacta de pasos de 20 ms que "debe", independiente
     del framerate. Las animaciones CSS (visuales) se disparan
     aparte — no afectan la lógica del PLC.

     El badge muestra "SCAN: 20 ms (configurado)" porque es un
     parámetro de diseño del PLC simulado, no una medición del
     repaint del navegador.
     ================================================================= */

  const PLC_SCAN_MS = 20;   // Período de scan configurado (ms)

  const STATES = Object.freeze({
    IDLE: 'IDLE', HABILITADO: 'HABILITADO', PIEZA_EN_CINTA: 'PIEZA_EN_CINTA',
    INSPECCION_INICIAL: 'INSPECCION_INICIAL', DESCARTE_INICIAL: 'DESCARTE_INICIAL',
    MECANIZANDO_AVANCE: 'MECANIZANDO_AVANCE', MECANIZANDO_RETROCESO: 'MECANIZANDO_RETROCESO',
    INSPECCION_FINAL: 'INSPECCION_FINAL', PIEZA_OK: 'PIEZA_OK', PIEZA_DEFECTUOSA: 'PIEZA_DEFECTUOSA',
    CICLO_COMPLETO: 'CICLO_COMPLETO', EMERGENCIA: 'EMERGENCIA'
  });
  const timingsMs = Object.freeze({ conveyorTime: 3000, inspectionTime: 1500, pressAdvanceTime: 2000, pressReturnTime: 1500, finalInspectionTime: 1000, classificationTime: 650 });
  const startedAt = Date.now();
  let state = STATES.IDLE;
  let cam1Result = 'CONFORME';
  let cam2Result = 'OK';
  const counters = { ok: 0, nok: 0, rejected: 0, cycles: 0 };
  let signals = makeIdleSignals();

  /* -- Timer PLC: timers contados en scans -- */
  let scanCount = 0;
  let plcTimers = [];
  let nextTimerId = 0;
  let plcRunning = false;
  let lastRafTime = 0;
  let accumulator = 0;
  let dirty = true;

  function msToScans(ms) { return Math.ceil(ms / PLC_SCAN_MS); }

  function schedulePlc(callback, delayMs) {
    const id = ++nextTimerId;
    plcTimers.push({ targetScan: scanCount + msToScans(delayMs), callback, id });
    return id;
  }
  function cancelAllPlcTimers() { plcTimers = []; }

  const $ = (id) => document.getElementById(id);
  const ui = {
    start: $('startBtn'), stop: $('stopBtn'), reset: $('resetBtn'), estop: $('estopBtn'),
    cam1Selector: $('cam1Selector'), cam2Selector: $('cam2Selector'), log: $('eventLog'), clearLog: $('clearLogBtn'),
    state: $('cycleState'), hmi: $('hmiScreen'), hmiText: $('hmiText'), hmiSubtext: $('hmiSubtext'), svgHmi: $('svgHmi'),
    headerLamp: $('headerLamp'), headerStatus: $('headerStatus'), overlay: $('emergencyOverlay'), plant: $('plantSvg'),
    part: $('movingPart'), drill: $('drillHead'), pusher: $('pusher'), opticalBeam: $('opticalBeam'),
    fillOK: $('fillOK'), fillNOK: $('fillNOK'), countOK: $('countOK'), countNOK: $('countNOK'),
    okCount: $('okCount'), nokCount: $('nokCount'), rejectCount: $('rejectCount'), cycleCount: $('cycleCount'),
    signalList: $('signalList'), ladder: $('ladderDiagram'), scanBadge: $('scan-badge')
  };

  const signalMeta = [
    ['K1', 'K1', 'Relé maestro T1'], ['K1_T4', 'K1 · T4', 'Relé cinta ingreso'], ['IFM', 'IFM', 'Barrera óptica'],
    ['CAM1_OK', 'CAM1 OK', 'Inspección inicial conforme'], ['CAM1_NOK', 'CAM1 NOK', 'Inspección inicial no conforme'],
    ['K3', 'K3', 'Expulsor de descarte inicial'], ['FC1', 'FC1', 'Cabezal en reposo'], ['FC2', 'FC2', 'Cabezal abajo'],
    ['CAM2_OK', 'CAM2 OK', 'Inspección final aprobada'], ['CAM2_NOK', 'CAM2 NOK', 'Inspección final defectuosa'],
    ['H1', 'H1', 'Sistema habilitado'], ['H2', 'H2', 'Parada / alarma']
  ];
  const rungs = [
    { n: 1, contacts: [['S0', 'NC'], ['S2', 'NO'], ['K1', 'NO']], coil: 'K1', active: () => signals.K1 },
    { n: 2, contacts: [['K1', 'NO'], ['IFM', 'NO']], coil: 'K1_T4', active: () => signals.K1_T4 && signals.IFM },
    { n: 3, contacts: [['K1_T4', 'NO'], ['CAM1 OK', 'NO']], coil: 'MATERIAL VÁLIDO', active: () => signals.CAM1_OK },
    { n: 4, contacts: [['K1_T4', 'NO'], ['CAM1 NOK', 'NO']], coil: 'K3 DESCARTE', active: () => signals.K3 },
    { n: 5, contacts: [['MATERIAL VÁLIDO', 'NO'], ['FC1', 'NC']], coil: 'T3 AVANCE', active: () => state === STATES.MECANIZANDO_AVANCE },
    { n: 6, contacts: [['AVANCE', 'NO'], ['FC2', 'NO']], coil: 'T3 RETROCESO', active: () => state === STATES.MECANIZANDO_RETROCESO },
    { n: 7, contacts: [['RETROCESO', 'NO'], ['FC1', 'NO']], coil: 'T5 · CAM2', active: () => state === STATES.INSPECCION_FINAL },
    { n: 8, contacts: [['CAM2 OK / NOK', 'NO']], coil: 'OK→VERDE / NOK→ROJO', active: () => signals.CAM2_OK || signals.CAM2_NOK }
  ];

  function makeIdleSignals() {
    return { K1: false, K1_T4: false, K3: false, IFM: false, CAM1_OK: false, CAM1_NOK: false, FC1: true, FC2: false, CAM2_OK: false, CAM2_NOK: false, H1: false, H2: true };
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
  function setState(next, message, tone = '') { state = next; if (message) log(message, tone); dirty = true; }
  function setMovingPart(visible, x = 0, y = 0, duration = 0) {
    ui.part.style.transition = duration ? `transform ${duration}ms linear` : 'none';
    ui.part.classList.toggle('hidden', !visible);
    ui.part.style.transform = `translate(${x}px, ${y}px)`;
  }
  function animatePart(from, to, duration) {
    setMovingPart(true, from.x, from.y, 0);
    requestAnimationFrame(() => requestAnimationFrame(() => setMovingPart(true, to.x, to.y, duration)));
  }

  function startSystem() {
    if (state === STATES.EMERGENCIA) return log('START inhibido: resetee la emergencia.', 'danger');
    if (signals.K1) return log('K1 ya está enclavado; la línea continúa activa.', 'warn');
    signals = makeIdleSignals();
    signals.K1 = true; signals.H1 = true; signals.H2 = false;
    setState(STATES.HABILITADO, 'S2 pulsado · K1 enclavado · línea habilitada.', 'ok');
    ui.start.classList.add('pressed');
    setTimeout(() => ui.start.classList.remove('pressed'), 200);
    schedulePlc(beginConveyor, 500);
  }
  function beginConveyor() {
    if (!signals.K1 || state === STATES.EMERGENCIA) return;
    signals.K1_T4 = true; signals.IFM = true; signals.CAM1_OK = false; signals.CAM1_NOK = false;
    signals.CAM2_OK = false; signals.CAM2_NOK = false; signals.K3 = false;
    setState(STATES.PIEZA_EN_CINTA, 'T4 detecta pieza · barrera IFM interrumpida.', 'ok');
    animatePart({ x: 315, y: 274 }, { x: 635, y: 274 }, timingsMs.conveyorTime);
    schedulePlc(beginInitialInspection, timingsMs.conveyorTime);
  }
  function beginInitialInspection() {
    signals.IFM = false;
    signals.CAM1_OK = cam1Result === 'CONFORME';
    signals.CAM1_NOK = !signals.CAM1_OK;
    setState(STATES.INSPECCION_INICIAL, 'T2 · Inspección Inicial en curso (CAM1).');
    setMovingPart(true, 700, 274, 500);
    schedulePlc(classifyInitialPiece, timingsMs.inspectionTime);
  }
  function classifyInitialPiece() { if (signals.CAM1_OK) approveInitialInspection(); else discardInitialPiece(); }
  function discardInitialPiece() {
    signals.K3 = true;
    setState(STATES.DESCARTE_INICIAL, 'T2 · pieza NO CONFORME → K3 activo · descarte inicial', 'warn');
    ui.pusher.classList.add('extended');
    setMovingPart(true, 770, 325, 650);
    schedulePlc(() => {
      counters.rejected += 1; counters.cycles += 1;
      signals.K3 = false; signals.CAM1_NOK = false;
      ui.pusher.classList.remove('extended'); setMovingPart(false);
      finishCycle('Descarte inicial finalizado; T3 y T5 no operaron.', 'warn', STATES.CICLO_COMPLETO);
    }, 850);
  }
  function approveInitialInspection() {
    signals.FC1 = false;
    setState(STATES.MECANIZANDO_AVANCE, 'T2 · Cámara 1: pieza CONFORME → MATERIAL_VALIDO habilitado', 'ok');
    animatePart({ x: 700, y: 274 }, { x: 985, y: 284 }, 750);
    ui.drill.classList.add('down');
    schedulePlc(beginReturn, timingsMs.pressAdvanceTime);
  }
  function beginReturn() {
    signals.FC2 = true;
    setState(STATES.MECANIZANDO_RETROCESO, 'FC2 activo · mecanizado completo · retroceso ordenado.', 'ok');
    ui.drill.classList.remove('down');
    schedulePlc(beginFinalInspection, timingsMs.pressReturnTime);
  }
  function beginFinalInspection() {
    signals.FC2 = false; signals.FC1 = true;
    setState(STATES.INSPECCION_FINAL, 'T3-X6 → T5 · Inspección final en curso (CAM2).');
    animatePart({ x: 985, y: 284 }, { x: 1180, y: 175 }, 750);
    schedulePlc(classifyFinalPiece, timingsMs.finalInspectionTime);
  }
  function classifyFinalPiece() {
    const isOk = cam2Result === 'OK';
    signals.CAM2_OK = isOk; signals.CAM2_NOK = !isOk;
    const destination = isOk ? { x: 1137, y: 260 } : { x: 1225, y: 260 };
    setMovingPart(true, destination.x, destination.y, timingsMs.classificationTime);
    dirty = true;
    schedulePlc(() => completeFinalClassification(isOk), timingsMs.classificationTime);
  }
  function completeFinalClassification(isOk) {
    setMovingPart(false);
    counters.cycles += 1;
    if (isOk) {
      counters.ok += 1;
      updateContainer(ui.fillOK, ui.countOK, counters.ok);
      finishCycle('T5 · CAM2: pieza OK → contenedor verde ✅', 'ok', STATES.PIEZA_OK);
    } else {
      counters.nok += 1;
      updateContainer(ui.fillNOK, ui.countNOK, counters.nok);
      finishCycle('T5 · CAM2: pieza DEFECTUOSA → contenedor rojo 🔴', 'warn', STATES.PIEZA_DEFECTUOSA);
    }
  }
  function updateContainer(fill, count, value) {
    const fillHeight = Math.min(100, value * 20);
    fill.setAttribute('y', String(210 - fillHeight));
    fill.setAttribute('height', String(fillHeight));
    count.textContent = value;
  }
  function finishCycle(message, tone = 'ok', finalState = STATES.CICLO_COMPLETO) {
    signals.IFM = false; signals.K1_T4 = false; signals.CAM1_OK = false; signals.CAM1_NOK = false;
    setState(finalState, message, tone);
    schedulePlc(() => {
      if (!signals.K1 || state === STATES.EMERGENCIA) return;
      signals.CAM2_OK = false; signals.CAM2_NOK = false;
      setState(STATES.HABILITADO, 'Ciclo rearmado · línea lista para siguiente pieza.', 'ok');
      schedulePlc(beginConveyor, 1200);
    }, 900);
  }

  function stopSystem(source = 'S1 STOP pulsado · autorretención K1 liberada.') {
    if (state === STATES.EMERGENCIA) return;
    cancelAllPlcTimers(); signals = makeIdleSignals(); setMovingPart(false);
    ui.drill.classList.remove('down'); ui.pusher.classList.remove('extended');
    setState(STATES.IDLE, source, 'warn');
  }
  function emergencyStop() {
    cancelAllPlcTimers(); signals = makeIdleSignals(); signals.H2 = true; setMovingPart(false);
    ui.drill.classList.remove('down'); ui.pusher.classList.remove('extended');
    setState(STATES.EMERGENCIA, 'S0 ACTIVADO · parada de categoría 0 · salidas desenergizadas.', 'danger');
  }
  function resetSystem() {
    if (state !== STATES.EMERGENCIA) return log('RESET ignorado: no hay emergencia activa.', 'warn');
    signals = makeIdleSignals();
    setState(STATES.IDLE, 'S0 liberado · sistema rearmado en IDLE.', 'ok');
  }

  /* ======= PLC SCAN — un paso de 20 ms lógico ======= */
  function plcScan() {
    scanCount++;
    const due = [];
    const remaining = [];
    for (const t of plcTimers) {
      if (scanCount >= t.targetScan) due.push(t);
      else remaining.push(t);
    }
    plcTimers = remaining;
    for (const t of due) t.callback();
    dirty = true;
  }

  /* ======= LOOP PRINCIPAL — acumulador determinista ======= */
  function mainLoop(now) {
    if (!plcRunning) return;
    if (lastRafTime === 0) lastRafTime = now;
    const dt = Math.min(now - lastRafTime, 200);
    lastRafTime = now;
    accumulator += dt;
    while (accumulator >= PLC_SCAN_MS) {
      accumulator -= PLC_SCAN_MS;
      plcScan();
    }
    if (dirty) { render(); dirty = false; }
    requestAnimationFrame(mainLoop);
  }

  function startPlcEngine() {
    if (plcRunning) return;
    plcRunning = true;
    lastRafTime = 0;
    accumulator = 0;
    requestAnimationFrame(mainLoop);
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
    ui.hmiSubtext.textContent = emergency ? 'S0 activo · reset requerido' : running ? 'K1 enclavado · 24 VCC' : 'Esperando habilitación';
    ui.svgHmi.textContent = emergency ? 'E-STOP' : running ? 'SYSTEM OK' : 'STANDBY';
    ui.plant.classList.toggle('plant-running', running);
    ui.plant.classList.toggle('plant-warning', state === STATES.DESCARTE_INICIAL || state === STATES.PIEZA_DEFECTUOSA);
    ui.plant.classList.toggle('plant-emergency', emergency);
    ['stationT1', 'stationT4', 'stationT2', 'stationT3', 'stationT5'].forEach((id) => $(id).classList.remove('active'));
    if (running) $('stationT1').classList.add('active');
    if (state === STATES.PIEZA_EN_CINTA) $('stationT4').classList.add('active');
    if ([STATES.INSPECCION_INICIAL, STATES.DESCARTE_INICIAL].includes(state)) $('stationT2').classList.add('active');
    if ([STATES.MECANIZANDO_AVANCE, STATES.MECANIZANDO_RETROCESO].includes(state)) $('stationT3').classList.add('active');
    if ([STATES.INSPECCION_FINAL, STATES.PIEZA_OK, STATES.PIEZA_DEFECTUOSA].includes(state)) $('stationT5').classList.add('active');
    $('lampH1').classList.toggle('active', signals.H1); $('lampH2').classList.toggle('active', signals.H2);
    $('sortGreen').classList.toggle('active', signals.CAM1_OK); $('sortYellow').classList.toggle('active', signals.CAM1_NOK);
    $('fc1').classList.toggle('active', signals.FC1); $('fc2').classList.toggle('active', signals.FC2);
    document.querySelectorAll('.station-power').forEach((lamp) => lamp.classList.toggle('active', signals.K1_T4));
    document.querySelectorAll('.belt').forEach((belt) => belt.classList.toggle('running', signals.K1_T4));
    ui.opticalBeam.classList.toggle('broken', signals.IFM);
    const finalActive = state === STATES.INSPECCION_FINAL || signals.CAM2_OK || signals.CAM2_NOK;
    [signals.K1, signals.K1_T4 && signals.IFM, signals.CAM1_OK, finalActive].forEach((active, index) => $(`wire${index + 1}`).classList.toggle('active', active));
    ui.okCount.textContent = counters.ok; ui.nokCount.textContent = counters.nok;
    ui.rejectCount.textContent = counters.rejected; ui.cycleCount.textContent = counters.cycles;
    ui.start.disabled = emergency || running; ui.stop.disabled = emergency || !running; ui.reset.disabled = !emergency;
    if (ui.scanBadge) ui.scanBadge.textContent = 'SCAN: ' + PLC_SCAN_MS + ' ms (configurado)';
    renderSignals(); renderLadder();
  }

  function initializePanels() {
    ui.signalList.innerHTML = signalMeta.map(([key, label, description]) => `<div class="signal-item${key.includes('NOK') ? ' danger' : ''}" data-signal="${key}"><i></i><span>${label}<small style="display:block;color:#63758c;font-size:7px">${description}</small></span><b>OFF</b></div>`).join('');
    ui.ladder.innerHTML = rungs.map((rung) => `<div class="rung" data-rung="${rung.n}"><span class="rung-no">R${rung.n}</span>${rung.contacts.map(([label, type]) => `<span class="contact ${type === 'NC' ? 'nc' : ''}"><span class="symbol">—| |—</span>${label} (${type})</span>`).join('<span class="wire-fill"></span>')}<span class="wire-fill"></span><span class="coil"><span class="symbol">—( )—</span>${rung.coil}</span></div>`).join('');
  }
  function bindSegmentedControl(element, attribute, onChange) {
    element.addEventListener('click', (event) => {
      const button = event.target.closest(`[data-${attribute}]`);
      if (!button) return;
      element.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
      onChange(button.dataset[attribute]);
    });
  }

  ui.start.addEventListener('click', startSystem);
  ui.stop.addEventListener('click', () => stopSystem());
  ui.estop.addEventListener('click', emergencyStop);
  ui.reset.addEventListener('click', resetSystem);
  ui.clearLog.addEventListener('click', () => { ui.log.innerHTML = ''; log('Registro de eventos reiniciado.'); });
  bindSegmentedControl(ui.cam1Selector, 'cam1', (value) => {
    cam1Result = value;
    log(`Resultado de Inspección Inicial ajustado a ${value.replace('_', ' ')}.`);
  });
  bindSegmentedControl(ui.cam2Selector, 'cam2', (value) => {
    cam2Result = value;
    log(`Resultado de Inspección Final ajustado a ${value}.`);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') emergencyStop();
    if (event.key.toLowerCase() === 's' && !event.repeat) startSystem();
  });

  initializePanels();
  log('Simulador inicializado · 0V común verificado.', 'ok');
  log('Motor PLC arrancado · ciclo fijo ' + PLC_SCAN_MS + ' ms · acumulador determinista.', 'ok');
  log('Planta en IDLE · pulse START para enclavar K1.');
  render();
  startPlcEngine();
})();
