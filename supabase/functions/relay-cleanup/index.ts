import { handler, json } from '../_shared/http.ts';

// Implemented in a later milestone.
Deno.serve(handler((req) => Promise.resolve(json(req, { error: 'not_implemented' }, 501))));
