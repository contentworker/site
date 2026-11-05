// Lets node:test import modules that use `cloudflare:workers` (only its base classes are needed).
import { register } from 'node:module';

register('./loader.ts', import.meta.url);
