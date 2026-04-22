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

### Proveedor

**NanoGPT** es el proveedor por defecto (roleplay, evaluador y resumidor). El modelo se elige en tres capas con esta prioridad:

1. Modelo elegido por el alumno en el selector de la UI (persistido en la sesión).
2. Campo `model` del escenario JSON.
3. Variable de entorno `DEFAULT_MODEL`.

El catálogo del selector se puebla desde `GET /api/models`, que proxea `https://nano-gpt.com/api/v1/models`. Si un escenario quiere acotar los modelos disponibles para sus alumnos, puede definir `allowed_models` (array de ids).

Los adapters para **Anthropic** (`claude-*`) y **OpenRouter** también están implementados para los escenarios que los necesiten; basta con indicar `provider` en el JSON del escenario y aportar la API key correspondiente.

## Instalación

Requisitos: **Node.js ≥ 22.5.0** (necesario para el driver SQLite incorporado). El backend no tiene dependencias nativas, así que no hace falta compilador ni Visual Studio Build Tools.

```bash
cd backend
cp .env.example .env   # edita las API keys
npm install
npm start
```

Abre http://localhost:3000/?student_id=demo&scenario_id=negociador-b2b

### Windows + OneDrive

Si el repo vive dentro de una carpeta sincronizada con OneDrive, `npm install` puede fallar con errores `EPERM` porque OneDrive mantiene archivos bloqueados mientras sincroniza. Soluciones:
- Mover el proyecto fuera de OneDrive (por ejemplo a `C:\dev\roleplay`), o
- Pausar la sincronización de OneDrive mientras se instalan dependencias.

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
| `GET` | `/api/models` | Catálogo de modelos de NanoGPT (cacheado 5 min; `?refresh=1` fuerza recarga). |
| `POST` | `/api/sessions` | Crea o reanuda una sesión. Body: `{student_id, scenario_id, model?}`. |
| `GET` | `/api/sessions/:id` | Estado completo de la sesión. |
| `PATCH` | `/api/sessions/:id/model` | Cambia el modelo usado por la sesión. Body: `{model}`. |
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
