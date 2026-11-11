import { DurableObject } from 'cloudflare:workers';
import { createApp } from './app.mjs';

export class Restaurant extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.app = createApp(ctx.storage, env);
  }

  fetch(request) {
    return this.app(request);
  }
}

export default {
  fetch(request, env) {
    return env.RESTAURANT.getByName('restaurante-da-familia').fetch(request);
  },
};
