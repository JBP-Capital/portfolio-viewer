# Self-hosting Portfolio Viewer

Portfolio Viewer runs as four containers:
- `db`: PostgreSQL, which holds all data.
- `auth`: the login service.
- `web`: the app.
- `worker`: loads prices.

You need Docker with Compose, about 1 GB of free memory, and an amd64 or arm64 machine (arm64 includes a
Raspberry Pi 4 or 5 with a 64-bit system).

## Install

1. Get this folder:
   `git clone https://github.com/JBP-Capital/portfolio-viewer.git && cd portfolio-viewer/deploy`.
2. `cp .env.example .env`.
3. In `.env`, fill in `POSTGRES_PASSWORD` (`openssl rand -hex 24`) and `JWT_SECRET` (`openssl rand -hex 32`).
   Set `PUBLIC_URL` to the address you will open in the browser, without a trailing slash.
4. `docker compose up -d`.
5. Open `PUBLIC_URL` and choose **Create account**. **The first account becomes the administrator.**
   After that the instance is invite-only.

`docker compose up -d` downloads the published images (`ghcr.io/jbp-capital/portfolio-viewer-web` and
`-worker`). If Docker answers `denied` for `ghcr.io`, the images are not available to you, and Compose builds
them from the checked-out source instead. That works, but takes several minutes and noticeably more memory
than running the app does. To build from source on purpose, for example after changing the code, run
`docker compose up -d --build`.

## Updating

Take a backup first (next section). Database changes are applied automatically when the new version
starts. The running version is shown at the bottom of every page and at `/api/health`.

**With the published images** (the default):

```sh
git pull
docker compose pull
docker compose up -d
```

By default you run the latest release. To update on your own schedule, set
`PORTFOLIO_VIEWER_VERSION=0.1.0` (or another release) in `.env`. To change versions, check out the
matching tag as well (`git fetch --tags && git checkout v0.1.0`), so that this folder and the images belong
together, then run `docker compose pull && docker compose up -d`.

**Built from source** (a modified copy, or images that were not available):

```sh
git pull
docker compose up -d --build
```

`docker compose pull` would replace your own build with the published image, so do not run it. If you run
a modified copy, set `WEB_IMAGE=portfolio-viewer-web:local` and `WORKER_IMAGE=portfolio-viewer-worker:local`
in `.env`, so that your builds never carry the name of the published images.

## Backup and restore

All data lives in the database: logins, portfolios, transactions and prices. Back it up to a single file:

```sh
docker compose exec -T db sh -c "pg_dump -U postgres -d portfolio -Fc > /tmp/portfolio.dump"
docker compose cp db:/tmp/portfolio.dump ./portfolio.dump
```

The file `portfolio.dump` is now in the current folder. Check that it is not empty, rename it with the
date, and keep copies somewhere other than this machine. To restore a backup into an empty instance, for
example on a new server with the same `.env`, first put the file next to `docker-compose.yml` and name it
`portfolio.dump`. Then:

```sh
docker compose down -v      # deletes the current data; skip this on a server that has none yet
docker compose up -d --wait db
docker compose cp ./portfolio.dump db:/tmp/portfolio.dump
docker compose exec -T db sh -c "pg_restore -U postgres -d portfolio --clean --if-exists /tmp/portfolio.dump"
docker compose up -d
```

Everyone signs in with their old password afterwards. The commands work in bash, PowerShell and cmd.
The file is written inside the container on purpose: a redirect with `>` on the host would corrupt a
binary file in Windows PowerShell.

## HTTPS and a domain

For anything beyond your own network, put a reverse proxy with TLS in front of the app. Let only the proxy
reach the app: set `PORT=127.0.0.1:3000` in `.env` and `PUBLIC_URL=https://portfolio.example.com`, then run
`docker compose up -d`. With [Caddy](https://caddyserver.com), which gets the certificate by itself, the
whole configuration is:

```
portfolio.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

## TV and Android

- **TV:** open `PUBLIC_URL/tv` in the TV's browser, or use the Android app on an Android TV. The TV shows a
  code. Enter that code on a phone signed in to Portfolio Viewer, at `PUBLIC_URL/pair`. The TV then shows
  your portfolios read-only. You can remove it any time under **Settings → TV devices**.
- **Android app:** see [`apps/android`](../apps/android/README.md). On first start it asks for your
  `PUBLIC_URL`.

## Source code of your instance

Every page links to its source code, as the AGPL-3.0 requires of software offered over a network. If you
change the code and let other people use your instance, publish your version and set
`SOURCE_URL=https://…` in `.env` to where it can be downloaded.

## Prices

The `worker` service keeps prices up to date for every security held in any portfolio:

- latest prices every 5 minutes while the security's exchange is open (`QUOTE_INTERVAL_MINUTES`),
- 10 years of daily closes within a minute after a security is first recorded, refreshed nightly,
- exchange rates from the European Central Bank every working day, intraday rates every 15 minutes.

The data source is chosen with `MARKET_DATA_PROVIDER` (default `yahoo`: Yahoo Finance plus the
ECB, free for private use — you are responsible for complying with their terms).

To try Portfolio Viewer without any outside data, set `MARKET_DATA_PROVIDER=demo`: the search then
offers four fixed demo securities (Agnico Eagle Mines, SAP, Fresnillo, Lahontan Gold) with ten
years of made-up daily prices and fixed exchange rates. It works offline and is what the end-to-end
tests use. Do not mix it with real holdings: switching providers does not replace prices already
stored.

## E-mail

Without SMTP settings, new accounts are confirmed automatically and password-reset e-mails cannot
be sent. With a mail server, fill in the `SMTP_*` lines in `.env` and set `EMAIL_AUTOCONFIRM=false`, so new
accounts must confirm their address.

## Inviting people

After the first account (the administrator), the instance is invite-only. Open **Admin**, enter
the person's e-mail address and choose "Create invite link". The link is shown once; send it
yourself (e-mail, messenger). It works once within 7 days: the person opens it, creates an account
(or signs in) and accepts the invitation. On the same page you can withdraw invites, disable or
re-enable members, make someone an administrator and delete members with all their data.

## Importing and exporting transactions

**Import** accepts CSV files as spreadsheets write them, with `,` or `;` as delimiter. In a `;`
file numbers are read the German way (`1.234,56`); dates may be `2026-01-05` or `05.01.2026`.
Every row is checked and shown in a preview; nothing is stored until you confirm, and one faulty
row stops the whole import. Portfolios that do not exist yet are created.

| Column | Content |
|---|---|
| `date` | trade date |
| `portfolio` | portfolio name (created when missing) |
| `type` | `buy`, `sell`, `dividend`, `transfer_in` (take over a holding at its average price), `transfer_out`, `split`; merger legs `exchange_out` / `exchange_in` as written by the export |
| `isin` or `symbol` + `exchange` | the security; `exchange` is the MIC, e.g. `XNYS`, `XETR`, `XLON`, `XTSX` |
| `quantity`, `price` | shares and price per share in `currency` (London prices in pence, `GBX`) |
| `currency` | three letters, e.g. `USD` |
| `fees`, `taxes` | optional, only for buys, sells and dividends |
| `amount` | dividends: gross amount (`quantity` optional: the shares it was paid on) |
| `note` | optional |
| `fx_rate` | optional: base currency per unit of `currency`, per pound for `GBX` (as in the app); without it the ECB rate of that day is used |
| `split_ratio` | splits: new shares per old share, e.g. `4` |
| `link` | merger legs: the same value on the `exchange_out` and the `exchange_in` row |

Example:

```csv
date;portfolio;type;isin;symbol;exchange;quantity;price;currency;fees
05.01.2026;Main;buy;CA0084741085;;;10;101,50;USD;4,90
```

Mergers are best recorded in the app. **Settings → Export** downloads every transaction in the
same format, merger legs included, so an export can be imported again (into another instance, or
after deleting the portfolio).

## Deleting accounts

Members delete their own account under **Settings**; administrators can delete members under
**Admin**. Both remove the login, all portfolios and all transactions; shared price data stays.
The last administrator cannot delete their account.
