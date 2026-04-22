# Roleplay e-learning module

Mini-app embebible para cursos de e-learning. Permite al alumno practicar una conversación de roleplay contra un agente LLM, con un quest tracker en vivo de los objetivos de aprendizaje y una evaluación final automática.

## Arquitectura

```
frontend/   HTML + CSS + JS vanilla. Se embebe vía <iframe>.
backend/    Node + Express + SQLite. Proxy hacia los proveedores LLM.
scenarios/  Un JSON por escenario (lo editan los programadores a petición del profesor).
docs/       Formato del JSON de escenario.
data/       SQLite persistente (ignorado por git).
```

### Flujo

1. El LMS incrusta el iframe con `?student_id=<id>&scenario_id=<id>`.
2. El backend carga el escenario desde `scenarios/<scenario_id>.json`, crea o reanuda la sesión (`student_id + scenario_id`), y devuelve historial + objetivos.
3. Cada turno: el mensaje del alumno se envía al modelo de roleplay (personalizado por escenario), la respuesta se guarda, y un segundo modelo barato (el "evaluador") revisa los objetivos de aprendizaje y actualiza el quest tracker.
4. Cuando la conversación pasa de `SUMMARY_THRESHOLD` mensajes, un resumidor comprime los mensajes antiguos en un "summary" que se inyecta en el system prompt, para mantener la ventana de contexto acotada.
5. Al pulsar **Finalizar y evaluar** se genera un informe final con score, puntos fuertes, áreas de mejora y feedback por objetivo.

### Proveedores soportados

- **Anthropic** (`claude-*`)
- **OpenRouter** (cualquier modelo del catálogo)
- **NanoGPT**

Las claves se configuran por variable de entorno. El escenario elige qué `provider` + `model` usa el agente de roleplay; el evaluador y el resumidor se configuran globalmente y se pueden sobreescribir por escenario.

## Instalación

```bash
cd backend
cp .env.example .env   # edita las API keys
npm install
npm start
```

Abre http://localhost:3000/?student_id=demo&scenario_id=negociador-b2b

## Embeber en una web

```html
<iframe
  src="https://tu-dominio.com/?student_id=<ID>&scenario_id=negociador-b2b"
  style="width:100%;height:640px;border:0"
  allow="clipboard-write">
</iframe>
```

El `student_id` lo inyecta el LMS (SCORM/LTI) desde el identificador del alumno.

## Añadir un escenario

1. Crea `scenarios/<id>.json` siguiendo [`docs/SCENARIO_FORMAT.md`](docs/SCENARIO_FORMAT.md).
2. Reinicia el backend (los escenarios se cachean al primer acceso).
3. Pasa `scenario_id=<id>` en la URL.

## API

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/health` | Healthcheck. |
| `GET` | `/api/scenarios` | Lista de escenarios disponibles. |
| `GET` | `/api/scenarios/:id` | Vista pública de un escenario (sin el system prompt). |
| `POST` | `/api/sessions` | Crea o reanuda una sesión. Body: `{student_id, scenario_id}`. |
| `GET` | `/api/sessions/:id` | Estado completo de la sesión. |
| `POST` | `/api/sessions/:id/messages` | Envía un turno y devuelve la respuesta + objetivos actualizados. Body: `{content}`. |
| `POST` | `/api/sessions/:id/regenerate` | Regenera la última respuesta del agente. |
| `POST` | `/api/sessions/:id/evaluate` | Genera el informe final y cierra la sesión. |
| `POST` | `/api/sessions/:id/reopen` | Reabre una sesión cerrada para seguir practicando. |

## Variables de entorno

Ver [`backend/.env.example`](backend/.env.example).

## Notas

- La persistencia es por `student_id + scenario_id`. Si el alumno vuelve con el mismo `student_id` y `scenario_id`, retoma exactamente donde lo dejó.
- Sin login propio: se asume que el LMS ya autentica al alumno antes de renderizar el iframe.
- La DB SQLite vive en `data/roleplay.db`. Haz backups de ese archivo si quieres conservar el progreso.
