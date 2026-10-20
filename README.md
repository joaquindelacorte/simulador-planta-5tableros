# Simulador Planta Automatizada 5 Estaciones — TP Automatización Industrial UNP 2026

Simulador web de una **línea de producción con doble control de calidad**, basada en los 5 tableros de relés didácticos en cascada.

**Deploy:** https://simulador-planta-5tableros.vercel.app  
**Repo:** https://github.com/joaquindelacorte/simulador-planta-5tableros

---

## Descripción del proceso (según TP)

La planta controla calidad en **dos momentos** del proceso:

1. **Inspección inicial (T2):** antes de mecanizar — detecta material incorrecto, pieza ausente o defecto visible. Si rechaza → expulsa a descarte inicial, NO entra a T3.
2. **Mecanizado (T3):** solo trabaja piezas aprobadas por T2.
3. **Inspección final (T5):** después de mecanizar — verifica que el trabajo esté bien. Si aprueba → contenedor verde (OK). Si rechaza → contenedor rojo (reproceso/rechazo).

---

## Estaciones

| Tablero | Estación | Función |
|---------|----------|---------|
| T1 | Consola de control | Marcha/Parada general, E-Stop S0, autorretención K1, HMI |
| T4 | Control de cinta | Mueve pieza, sensor óptico IFM confirma PIEZA_PRESENTE |
| T2 | **Inspección inicial** | Cámara 1 (sim.) → OK habilita T3 / NOK expulsa por K3 a descarte |
| T3 | Mecanizado | Taladro/prensa neumático: avance FC2 + retroceso FC1 |
| T5 | **Inspección final** | Cámara 2 (sim.) → OK a contenedor verde / NOK a contenedor rojo |

---

## Señales inter-tablero (24Vcc — sin cambios respecto al PDF original)

```
T1-X4 → T4-X3   +24V LINEA_HABILITADA     (rojo 0.75mm²)
T4-X5 → T2-X3   +24V PIEZA_PRESENTE       (rojo 0.75mm²)
T2-X5 → T3-X3   +24V MATERIAL_VALIDO      (pieza conforme a inspección inicial)
T3-X6 → T5-X4   +24V PROCESO_TERMINADO    (rojo 0.75mm²)
GND 0Vcc común → todos (azul 0.75mm²)
```

---

## Flujo del ciclo

```
START → K1 enclava → T4 cinta → IFM detecta pieza
  → T2 INSPECCIÓN INICIAL:
      [CONFORME]  → señal MATERIAL_VALIDO → T3 mecaniza (avance FC2, retroceso FC1)
                                          → T5 INSPECCIÓN FINAL:
                                              [OK]          → contenedor verde ✅
                                              [DEFECTUOSA]  → contenedor rojo 🔴
      [NO CONFORME] → K3 expulsa a descarte inicial (T3 y T5 no operan)

E-STOP (S0): parada Cat 0 instantánea en cualquier estado → RESET antes de reiniciar
```

---

## Estado actual del simulador (v0.1)

### ✅ Funciona (lógica base)
- START/STOP/RESET/E-STOP
- Ciclo automático encadenado T1→T4→T2→T3→T5
- Selector CONFORME / NO CONFORME (reemplaza metal/plástico)
- Ladder diagram 8 rungs en tiempo real
- Log de eventos + contadores
- Señales de campo en tiempo real

### ❌ Pendiente / incorrecto
- T5 actual: es una tolva con nivel — debe ser dos contenedores (verde/rojo) con clasificación
- T2 actual: usa terminología metal/plástico — debe ser CONFORME/NO CONFORME (inspección 1)
- Animación de pieza: CSS transitions con saltos — debe ser rAF continuo

---

## Backlog de mejoras (orden de trabajo)

### M1 — Animación rAF continua T4→T2→T3→T5 *(en progreso)*
**Qué:** reemplazar CSS transitions encadenadas por `requestAnimationFrame` con waypoints.  
**Ruta CONFORME:** T4 → T2 → T3 (cabezal baja/sube) → T5 (a contenedor verde o rojo)  
**Ruta NO CONFORME:** T4 → T2 → expulsión lateral por K3 → bandeja descarte (T3/T5 no operan)

### M2 — Rediseño T5: contenedor verde + contenedor rojo
**Qué:** reemplazar la tolva/silo por dos contenedores de salida con selector CAM2 (OK / DEFECTUOSA).  
**Criterio:**
- Después del mecanizado (T3-X6), la pieza llega a T5
- Selector "Resultado Inspección Final": OK / DEFECTUOSA (simula cámara 2)
- OK → pieza va al contenedor verde, contador "Piezas OK" sube
- DEFECTUOSA → pieza va al contenedor rojo, contador "Piezas defectuosas" sube
- Ambos contenedores se llenan visualmente (nivel o count visible)
- Eliminar: sensor B1_cap nivel, compuerta K2, modo manual/auto de descarga

### M3 — Renombrar T2 a Inspección Inicial
**Qué:** cambiar terminología METAL/PLÁSTICO por CONFORME/NO CONFORME.  
**Criterio:**
- Selector pasa a llamarse "RESULTADO INSPECCIÓN 1" con opciones CONFORME / NO CONFORME
- Señal interna: `CAM1_OK` (true = conforme, false = no conforme)
- Log: "T2 · Cámara 1: pieza CONFORME → MATERIAL_VALIDO a T3" / "T2 · pieza NO CONFORME → K3 descarte inicial"
- Pilotos: verde = CONFORME, rojo/amarillo = NO CONFORME

### M4 — Cinta T4 animada cuando línea en marcha
**Qué:** patrón de cinta se mueve con CSS @keyframes cuando K1_T4 = ON.

### M5 — Cabezal T3 con movimiento vertical claro
**Qué:** drillHead baja visiblemente ~60px, "vibración" en trabajo, sube. FC1/FC2 se iluminan exacto.

### M6 — Cables inter-tablero con pulso animado
**Qué:** al activarse cada Enlace (1/2/3/4), un pulso viaja por el cable SVG (stroke-dashoffset).

### M7 — Panel de estadísticas de producción
**Qué:** panel resumen con: piezas ingresadas / conformes (pasaron T2) / mecanizadas (pasaron T3) / OK finales / defectuosas finales / descarte inicial. Porcentaje de calidad.

### M8 — Modo paso a paso (STEP)
**Qué:** botón STEP alterna auto/manual. En manual, "SIGUIENTE PASO" avanza un estado.

### M9 — Inyección de fallas
**Qué:** panel para forzar fallas: FC1 abierto, FC2 abierto, IFM desconectado, CAM1 falla, CAM2 falla.

### M10 — Modal diagrama eléctrico por tablero
**Qué:** click en estación → modal con esquema de bornas y relés de ese tablero.

---

## Timings actuales (script.js)

```js
conveyorTime:     3000ms   // T4 viaje en cinta
inspectionTime:   1500ms   // T2 inspección inicial
pressAdvanceTime: 2000ms   // T3 avance hasta FC2
pressReturnTime:  1500ms   // T3 retroceso hasta FC1
storageTime:      1000ms   // T5 clasificación final
```

## Stack
HTML5 + CSS3 + Vanilla JS — sin frameworks, sin npm. Abrí `index.html` en el navegador.
