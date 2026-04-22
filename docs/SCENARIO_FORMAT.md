# Scenario JSON format

A scenario is a single `.json` file inside `scenarios/`. The filename (without `.json`) must match the `id` field and is also the value passed to the frontend as `scenario_id`.

## Full example

See [`scenarios/negociador-b2b.json`](../scenarios/negociador-b2b.json) for a complete, working scenario.

## Fields

| Field | Required | Description |
|---|---|---|
| `id` | yes | URL-safe id (`[a-z0-9-_]+`). Must match filename. |
| `name` | yes | Human-readable title shown in the header. |
| `description` | no | Short subtitle shown under the name. |
| `provider` | yes | `anthropic` \| `openrouter` \| `nanogpt`. Selects which API key and endpoint the backend uses. |
| `model` | yes | Provider-specific model id (e.g. `claude-sonnet-4-6`, `openai/gpt-4o-mini`, etc.). |
| `temperature` | no | Sampling temperature for the roleplay model. Default `0.8`. |
| `max_tokens` | no | Max tokens per agent reply. Default `1024`. |
| `character` | no | `{ name, role, personality, ... }`. Only `name` is used by the UI (as the speaker label); the rest is for your own reference. |
| `system_prompt` | yes | The full system prompt that defines the agent's persona, constraints and behaviour. Usually the biggest field. |
| `first_message` | no | Opening line the agent sends before the student writes anything. Shown in the UI and stored in history, but dropped when calling Anthropic (which requires the conversation to start with a user turn). |
| `learning_objectives` | yes | Non-empty array. See below. |
| `evaluation_rubric` | no | Free-form JSON passed to the final evaluator. Use it for weights, notes, grading rules. |
| `evaluator` | no | `{ provider, model }` overriding the global evaluator model for this scenario. |
| `summarizer` | no | `{ provider, model }` overriding the global summariser model for this scenario. |

## Learning objectives

Each objective is tracked live in the side panel and included in the final report.

```json
{
  "id": "rapport",
  "name": "Establecer rapport inicial",
  "description": "Descripción corta que se muestra al alumno.",
  "success_criteria": "Criterio preciso que el evaluador usa para decidir si está cumplido."
}
```

- `id`: stable key used in the DB. Keep it short and unique within the scenario.
- `name`: shown to the student.
- `description`: shown to the student under the name. Keep it actionable.
- `success_criteria`: shown only to the evaluator model. The more specific and observable it is, the more reliable the quest tracker becomes.

## Tips for writing a good scenario

- Write the `system_prompt` like a script brief: who the character is, what they care about, what they refuse to do, how they speak. Include explicit "do not break character" instructions.
- Give the character real internal state (hidden needs, objections, priorities). That's what turns a flat chatbot into a useful practice partner.
- Make `success_criteria` observable in the transcript. "Shows empathy" is too vague; "acknowledges the customer's concern before proposing a solution" is checkable.
- Keep 3-6 objectives. Fewer feels empty, more is hard to track live.
- Use a strong model for the roleplay (`claude-sonnet-4-6`, or a top OpenRouter model). Use a cheaper one as evaluator (configured globally via `EVALUATOR_MODEL`).
