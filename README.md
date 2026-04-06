<p align="center">
  <img src="./logo.png" alt="Potion Storage" width="120" />
</p>

<h1 align="center">potion-storage-relay</h1>

<p align="center">
  WebSocket relay server for Potion Storage. Bridges the RuneLite plugin and the web app — delivering party commands (join/leave passphrases) to connected plugin clients in real time.
</p>

---

## How it works

```
Web app (Next.js)
  └── inserts PluginCommand row into PostgreSQL
        └── NOTIFY trigger broadcasts row to "plugin_command" channel
              └── relay receives via LISTEN, pushes COMMAND to connected plugin client
                    └── RuneLite plugin calls PartyService.changeParty(passphrase)
```

The plugin connects over WebSocket, authenticates with a plugin token, and maintains a persistent connection. The relay listens for PostgreSQL `NOTIFY` events on the `plugin_command` channel and forwards commands as they arrive. The trigger is managed by a Prisma migration in the web app repository.

The message protocol is defined in the [plugin repository](https://github.com/HavardPede/link).

## Commands

```bash
npm run dev        # development with hot reload (tsx watch)
npm run build      # compile TypeScript to dist/
npm start          # run compiled output
npm test           # run unit tests (Vitest)
npm run test:watch # watch mode
```

## Deployment

Deployed to [Fly.io](https://fly.io) via GitHub Actions on push to `main`. The app name is `potion-storage-relay`, primary region `ams`.

To deploy manually:

```bash
flyctl deploy
```

Requires `FLY_API_TOKEN` in your environment (or as a GitHub Actions secret for CI).

## Health check

```
GET /health → { "status": "ok", "connections": <number> }
```
