# CS3227-2610-MP3

## SoCLaaS reachability smoke test (temporary)

`spec/tech-stack.md` requires confirming that the SoC LLM (SoCLaaS) is reachable from Vercel before building around it. `GET /api/smoke/soclaas` checks this by calling `GET /v1/models` and sending one 5-token chat completion with synthetic input. It returns only status codes, latency and model IDs, never model output or credentials.

1. Copy `.env.template` to `.env.local` (locally) or add the same variables to Vercel (**Project → Settings → Environment Variables**): `SOCLAAS_BASE_URL`, `SOCLAAS_API_KEY`, `SOCLAAS_MODEL` (an `id` from `/models`) and `SMOKE_TEST_TOKEN` (a long random string).
2. Call it from outside the university network/VPN:

   ```sh
   curl -H "Authorization: Bearer <SMOKE_TEST_TOKEN>" https://<deployment-url>/api/smoke/soclaas
   ```

3. `models.ok: true` and `chat.replied: true` mean SoCLaaS is reachable. `status: null` with a `TimeoutError`/`TypeError` usually means a network or IP restriction.

Record the result in `logs/`, then remove `src/app/api/smoke/` and `SMOKE_TEST_TOKEN`.
