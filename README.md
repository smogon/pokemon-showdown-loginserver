**OLD Pokemon Showdown Loginserver.**

This was once the PS loginserver. It has been renamed the API server, and is now [a part of the client repository](https://github.com/smogon/pokemon-showdown-client/tree/master/api).

<details><summary>Old README</summary>

This is the PS loginserver.

Run it in the foreground with `npm run run`, or under PM2 with `npm start` and `npm stop`.

Pass a config path after `--`, for example `npm run run -- config/config.cjs`.

Access it via `/api/[action]`.

See `src/actions.ts` for a list of the actions. (Actions can be added by adding a function to that file)

</details>
