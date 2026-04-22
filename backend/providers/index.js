import * as anthropic from './anthropic.js';
import * as openrouter from './openrouter.js';
import * as nanogpt from './nanogpt.js';

const providers = { anthropic, openrouter, nanogpt };

export function getProvider(name) {
  const p = providers[name];
  if (!p) throw new Error(`Unknown provider: ${name}`);
  return p;
}

export async function chat({ provider, ...rest }) {
  return getProvider(provider).chat(rest);
}
