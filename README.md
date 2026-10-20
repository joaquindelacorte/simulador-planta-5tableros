# Simulador Planta Automatizada 5 Tableros — TP Automatización Industrial UNP 2026

Simulador web de la **línea de producción automatizada 5-en-1** que emula los 5 bancos didácticos de relés en cascada.

**Deploy:** https://simulador-planta-5tableros.vercel.app  
**Repo:** https://github.com/joaquindelacorte/simulador-planta-5tableros

---

## Estado actual (v0.1 — base funcional)

### ✅ Lo que ya funciona
- Botón START enclava K1 y arranca el ciclo automático
- Botón STOP detiene la línea
- EMERGENCY STOP corta todo instantáneamente (Cat 0)
- RESET desde emergencia vuelve a IDLE
- Selector METAL / PLÁSTICO cambia el comportamiento de T2
- Ciclo completo METAL: T1 → T4 → T2 → T3 (avance+retroceso) → T5 almacena
- Ciclo PLÁSTICO: T2 activa K3 (pusher) y descarta sin pasar a T3/T5
- Tolva T5 llena progresivamente; bloquea ciclo cuando B1_CAP = ON
- Señales de campo en tiempo real (panel derecho)
- Diagrama Ladder con 8 rungs iluminados según estado
- Log de eventos con timestamps
- Contadores: metales / plásticos / ciclos

---

## Mejoras planificadas (backlog — de a una)

### M1 — Animación de pieza continua entre estaciones
**Problema:** la pieza azul no se ve viajando de T4 → T2 → T3 → T5.  
**Criterio:** pieza sale de T4, recorre cinta con rAF, pasa por T2, llega a T3 (cabezal baja/sube), cae en tolva T5.

### M2 — Cabezal taladro T3 con movimiento visible
**Problema:** el desplazamiento vertical del drillHead no es evidente.  
**Criterio:** baja ~60px hasta FC2 (animado), efecto de "trabajo", sube hasta FC1. Los limit switches se iluminan en el momento exacto.

### M3 — Pusher K3 de T2 animado
**Problema:** el brazo del pusher no se mueve visualmente.  
**Criterio:** con PLÁSTICO, el brazo se extiende lateralmente y la pieza cae a la bandeja de descarte.

### M4 — Cinta T4 con movimiento de banda
**Problema:** la cinta está estática aunque la línea esté en marcha.  
**Criterio:** patrón de cinta animado con CSS @keyframes cuando K1_T4 = ON; se detiene al parar.

### M5 — Nivel de tolva T5 más visible + LEVEL FULL
**Problema:** el fill de la tolva es pequeño y difícil de leer.  
**Criterio:** nivel sube claramente pieza a pieza; a 100% tolva parpadea rojo y muestra "LEVEL FULL" bien visible.

### M6 — Cables inter-tablero con pulso animado
**Problema:** los cables +24V cambian de color pero sin efecto llamativo.  
**Criterio:** al activarse cada enlace (1/2/3/4) hay un pulso que viaja de tablero origen a destino (stroke-dashoffset). Rojo = activo, gris = inactivo.

### M7 — Ladder mejorado (símbolos NC + tamaño)
**Problema:** ladder pequeño, sin símbolo diagonal en contactos NC.  
**Criterio:** contactos NC con `─┤/├─`, ladder más grande y legible, etiquetas de tablero por rung.

### M8 — Modo paso a paso (STEP)
**Criterio:** botón STEP MODE alterna automático/manual. En manual, "SIGUIENTE PASO" avanza un estado a la vez.

### M9 — Inyección de fallas
**Criterio:** panel FALLAS permite forzar: FC1/FC2 abierto, tapa T5 abierta, IFM desconectado. Cada falla produce comportamiento específico.

### M10 — Modal de diagrama eléctrico por tablero
**Criterio:** click en una estación abre modal con esquema eléctrico interno (bornas, relés, cables).

---

## Arquitectura

### Señales inter-tablero (24Vcc)
```
T1-X4 → T4-X3   +24V LINEA_HABILITADA   (rojo 0.75mm²)
T4-X5 → T2-X3   +24V PIEZA_PRESENTE     (rojo 0.75mm²)
T2-X5 → T3-X3   +24V MATERIAL_VALIDO    (solo metal, rojo 0.75mm²)
T3-X6 → T5-X4   +24V PROCESO_TERMINADO  (rojo 0.75mm²)
GND 0Vcc común → todos (azul 0.75mm²)
```

### Estaciones
| Tablero | Función | Componentes clave |
|---------|---------|-------------------|
| T1 | Pupitre mando + seguridad | K1 autorretención, S0 E-Stop, S1 Stop, S2 Start, H1/H2 |
| T4 | Cinta ingreso + barrera óptica | IFM O5P701 réflex, B2 inductivo, K1 Comat C9-A41 |
| T2 | Inspección + clasificación | B1 inductivo (metal), B2 capacitivo (plástico), K3 pusher, 3×IDEC RJ2S |
| T3 | Prensa / taladro neumático | FC1 reposo, FC2 trabajo, 5×Omron G2RV, 2×Phoenix Contact |
| T5 | Tolva almacenamiento | B1 cap nivel, B2 ind tapa, K2 compuerta |

### Ciclos
- **METAL:** IDLE → HABILITADO → PIEZA_EN_CINTA → INSPECCION → MECANIZANDO_AVANCE → MECANIZANDO_RETROCESO → ALMACENANDO → CICLO_COMPLETO
- **PLÁSTICO:** IDLE → HABILITADO → PIEZA_EN_CINTA → INSPECCION → DESCARTE
- **EMERGENCIA:** cualquier estado → E-STOP → EMERGENCIA → RESET → IDLE

### Timings (script.js)
```js
conveyorTime:     3000ms   // T4: viaje en cinta
inspectionTime:   1500ms   // T2: inspección
pressAdvanceTime: 2000ms   // T3: avance hasta FC2
pressReturnTime:  1500ms   // T3: retroceso hasta FC1
storageTime:      1000ms   // T5: apertura compuerta
```

## Stack
HTML5 + CSS3 + Vanilla JS — sin frameworks, sin npm. Abrí index.html directo en el navegador.
