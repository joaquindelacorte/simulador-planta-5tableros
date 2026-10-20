# Simulador Planta Automatizada 5 Tableros — TP Automatización Industrial UNP 2026

Simulador web de una **línea de producción automatizada 5-en-1** que emula los 5 bancos didácticos de relés en cascada de la Cátedra de Automatización Industrial, Facultad de Ciencias Aplicadas — Universidad Nacional de Pilar.

## Estaciones en cascada

| Tablero | Estación | Función |
|---------|----------|---------|
| T1 | Pupitre de Mando Central | Seguridad cabecera, E-Stop, autorretención K1 |
| T4 | Cinta de Ingreso / Barrera Óptica | Sensor IFM O5P701 réflex, detección de pieza |
| T2 | Inspección y Clasificación | Inductivo B1 (metal) + Capacitivo B2 (plástico), pusher K3 |
| T3 | Prensa / Taladro Neumático | Secuenciador biestable FC1/FC2, 5x relés Omron G2RV |
| T5 | Tolva / Silo de Almacenamiento | Nivel capacitivo B1, interlock tapa B2, compuerta K2 |

## Señales inter-tablero (24Vcc)

```
T1-X4 → T4-X3  (+24V LINEA_HABILITADA)
T4-X5 → T2-X3  (+24V PIEZA_PRESENTE)
T2-X5 → T3-X3  (+24V MATERIAL_VALIDO — solo metal)
T3-X6 → T5-X4  (+24V PROCESO_TERMINADO)
GND unificado (cable azul 0.75mm²) → todos los tableros
```

## Flujo del ciclo

```
IDLE → START → K1 autorretención → T4 activa → pieza ingresa
  → T2: [METAL] → T3 secuencia avance/retroceso → T5 almacena → CICLO_COMPLETO
  → T2: [PLÁSTICO] → pusher K3 expulsa → DESCARTE (sin pasar por T3/T5)
E-STOP: parada instantánea Cat 0 en cualquier estado
```

## Stack

- **Simulador web**: HTML5 + CSS3 + Vanilla JS (sin frameworks)
- **Planta OIP**: Open Industry Project (`.oip`)
- **Deploy**: Netlify (drag & drop)

## Archivos

```
index.html       — simulador principal
style.css        — tema dark industrial
script.js        — state machine + lógica ladder
planta_5tableros.oip  — modelo OIP importable
```

## Uso

Abrí `index.html` en cualquier navegador moderno. No requiere servidor.
