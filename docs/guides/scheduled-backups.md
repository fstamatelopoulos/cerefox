# Scheduled backups in a container

Take a JSON snapshot of each of your Cerefox stores every night, on an
always-on machine (a NAS, a home server), and keep the last two weeks of them.
Requires a Cerefox release with `backup create --keep` (the first release after
v1.22.2) and, for a Cerefox Local store on your network, **v1.22.0 or newer**
on that host.

## How it works

- **The `cerefox` CLI does the work.** `cerefox backup create` writes one JSON
  file with every document, chunk (embeddings included), project and
  membership. `cerefox backup restore` loads it into any Cerefox.
- **It runs in a container** made from the published web image,
  `ghcr.io/fstamatelopoulos/cerefox-web`, which contains the CLI. The container
  does not start the web server: its command is replaced with a small shell loop
  that sleeps until the backup time, runs the backups and sleeps again. The
  image has no cron, and needs none.
- **One config directory per store.** Each store gets a folder with its own
  `.env` (a URL and a key). Each run picks one with `CEREFOX_CONFIG_DIR`, the
  same way you would point the CLI at a staging environment
  ([`staging-env.md`](staging-env.md)).
- **Snapshots go to a mounted folder**, one subfolder per store, and
  `--keep 14` deletes the oldest ones so at most 14 remain.

`--keep` only counts files `backup create` itself writes, named
`cerefox-<stamp>.json` (or `cerefox-<label>-<stamp>.json` when the store's
`.env` sets `CEREFOX_ENV_LABEL`), ordered by the time in the name. A snapshot
you made by hand with `--label` is never counted, nothing else in the folder is
touched, and a run that fails deletes nothing.

## 1. The folders

On the host, one folder for the config and one for the snapshots:

```
/srv/cerefox-backup/
  config/
    supabase/.env      # a Supabase store
    lan/.env           # a Cerefox Local store on your network
  backups/             # snapshots land in backups/supabase, backups/lan
```

The names `supabase` and `lan` are yours to choose; they are just how the loop
below refers to each store.

## 2. One `.env` per store

**A Supabase store** needs its project URL and its secret key (the same values
as in `~/.cerefox/.env` on the machine where you set it up):

```bash
CEREFOX_SUPABASE_URL=https://YOUR-REF.supabase.co
CEREFOX_SUPABASE_KEY=sb_secret_YOUR-SECRET-KEY
```

**A Cerefox Local store on your network** is reached the way
[`setup-lan.md`](setup-lan.md#the-cli-and-coding-agents-cerefox-local-only)
describes: its address and its API key, in the same two variables.

```bash
CEREFOX_SUPABASE_URL=http://192.168.1.50:8000
CEREFOX_SUPABASE_KEY=cfx_lak_YOUR-KEY
CEREFOX_ENV_LABEL=lan
```

- **Use the host's network address**, even when the backup container runs on
  the same machine. Inside a container, `localhost` is the container itself.
- **A Cerefox Local on a laptop** (the default install, published on
  `127.0.0.1` only) cannot be reached from another container. Back it up from
  the laptop instead: `cerefox-local backup create` in that machine's own
  scheduler.
- **No OpenAI key is needed.** A backup copies the stored embeddings; it does
  not compute any.

## 3. Permissions

The image runs as an unprivileged user, uid 1000. Give it the folders and keep
everyone else out:

```bash
sudo chown -R 1000:1000 /srv/cerefox-backup
sudo chmod 700 /srv/cerefox-backup /srv/cerefox-backup/config \
  /srv/cerefox-backup/config/* /srv/cerefox-backup/backups
sudo chmod 600 /srv/cerefox-backup/config/*/.env
```

If you would rather keep the folders owned by your own account, add
`user: "UID:GID"` (your account's numbers, from `id`) to the service below and
`HOME: /tmp` to its environment.

## 4. The compose file

Put it in a folder of its own, for example `/srv/cerefox-backup/project/compose.yml`,
not in the config folder.

```yaml
services:
  cerefox-backup:
    image: ghcr.io/fstamatelopoulos/cerefox-web:vX.Y.Z   # a release with --keep
    container_name: cerefox-backup
    restart: unless-stopped
    environment:
      STORES: "supabase lan"   # folder names under /config
      BACKUP_AT: "03:00"       # daily, in TZ below
      KEEP: "14"
      TZ: UTC
    volumes:
      - /srv/cerefox-backup/config:/config:ro
      - /srv/cerefox-backup/backups:/backups
    # The image's healthcheck probes the web server, which does not run here.
    healthcheck:
      disable: true
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        while :; do
          now=$$(date +%s)
          next=$$(date -d "today $$BACKUP_AT" +%s)
          [ "$$next" -gt "$$now" ] || next=$$(date -d "tomorrow $$BACKUP_AT" +%s)
          echo "next backup: $$(date -d @$$next)"
          sleep $$((next - now))
          for store in $$STORES; do
            echo "$$(date) backing up $$store"
            CEREFOX_CONFIG_DIR="/config/$$store" cerefox backup create \
              --output-dir "/backups/$$store" --keep "$$KEEP" \
              || echo "$$(date) backup of $$store FAILED"
          done
        done
```

- **`$$` is not a typo.** Compose would otherwise replace `$name` with a value
  from the host; `$$` passes a literal `$` through to the shell in the container.
- **The entrypoint is replaced on purpose.** The image's own entrypoint starts
  the web server and refuses to run without a web API key; neither applies to
  a backup job.
- **A failed store does not stop the others.** The failure is in the log (see
  [Checking it works](#checking-it-works)) and that store's older snapshots are
  kept.
- **Pin the tag** and change it to upgrade, as you would for any image. If the
  host cannot pull from `ghcr.io`, copy the image over as a file
  ([`setup-lan.md`](setup-lan.md#if-the-host-cannot-pull-the-image)).

Start it with `docker compose up -d` in the project folder.

## On a Synology NAS

With **Container Manager** on DSM 7.2. The folders need a shell once, to set
the owner and the permissions, so enable SSH for the setup
(**Control Panel → Terminal & SNMP**) and turn it off again afterwards.

**1. Make the folders and the `.env` files** over SSH:

```bash
sudo mkdir -p /volume1/docker/cerefox-backup/project \
  /volume1/docker/cerefox-backup/config/supabase \
  /volume1/docker/cerefox-backup/config/lan \
  /volume1/docker/cerefox-backup/backups
sudo vi /volume1/docker/cerefox-backup/config/supabase/.env   # contents as in step 2
sudo vi /volume1/docker/cerefox-backup/config/lan/.env
sudo chown -R 1000:1000 /volume1/docker/cerefox-backup/config \
  /volume1/docker/cerefox-backup/backups
sudo chmod 700 /volume1/docker/cerefox-backup/config \
  /volume1/docker/cerefox-backup/config/* /volume1/docker/cerefox-backup/backups
sudo chmod 600 /volume1/docker/cerefox-backup/config/*/.env
```

`/volume1` is the first storage volume; File Station shows which volume your
`docker` shared folder is on (right-click the folder, Properties). If the
Cerefox Local you back up runs on this same NAS, its `.env` still uses the
NAS's network address, for example `http://192.168.1.50:8000`.

**2. Get the image** under **Registry**, or import it as a file if the
download fails (**Image → Import → Add from file**, as in
[`setup-lan.md`](setup-lan.md#on-a-synology-nas) step 3).

**3. Create the Project.** **Project → Create**:

- **Project name:** `cerefox-backup`.
- **Path:** `docker/cerefox-backup/project`.
- **Source:** "Create docker-compose.yml", and paste the compose file from
  step 4 with the two volume lines changed to:

```yaml
    volumes:
      - /volume1/docker/cerefox-backup/config:/config:ro
      - /volume1/docker/cerefox-backup/backups:/backups
```

Skip the web portal step and finish. **Container → cerefox-backup → Log**
should show the time of the next backup.

The `backups` folder is then part of the `docker` shared folder, so Hyper
Backup or Snapshot Replication of that folder carries the snapshots off the NAS
too.

## Security

- **The Supabase `.env` holds your secret key, which is full access** to that
  store: it reads, changes and deletes everything and bypasses every access
  rule. The Cerefox Local API key is the same for its store. Anyone who can read
  `config/` owns both stores.
- **Keep the permissions tight:** `0600` on each `.env`, `0700` on the folders,
  owned by the container's user. Mount `config/` read-only, as above.
- **The snapshots are your whole knowledge base in plain JSON**, unencrypted.
  Protect `backups/` like the stores themselves, and when you copy it elsewhere
  (cloud storage, another disk), use a destination you would trust with the
  documents.
- **Keep the compose file free of keys.** Here it holds none; the keys live only
  in the `.env` files.

## Checking it works

**Run one now** instead of waiting for the night:

```bash
docker exec -e CEREFOX_CONFIG_DIR=/config/supabase cerefox-backup \
  cerefox backup create --output-dir /backups/supabase --keep 14
docker logs cerefox-backup        # the loop's log: next run, each backup, failures
ls -l /srv/cerefox-backup/backups/supabase /srv/cerefox-backup/backups/lan
```

Each run prints `Backup written: <file>`, the counts, and the snapshots it
pruned. `cerefox status` with the same `-e CEREFOX_CONFIG_DIR=…` checks a
store's URL and key without taking a backup.

**Test a restore**, now and then, into a scratch Cerefox Local on your own
computer ([`setup-local.md`](setup-local.md) installs `cerefox-local`). The
variables below give the scratch copy its own container, data volume, config
and port, so an install you already use is not touched:

```bash
export CEREFOX_LOCAL_CONTAINER=cerefox-scratch \
  CEREFOX_LOCAL_VOLUME=cerefox_scratch_pgdata \
  CEREFOX_LOCAL_CONFIG_DIR=~/.cerefox/scratch
cerefox-local init --port 8010 --embedder openai --openai-key sk-YOUR-OPENAI-KEY
cerefox-local backup restore ~/Downloads/cerefox-20261107T030000Z.json
cerefox-local document list
cerefox-local search "something you know is in there"
cerefox-local uninstall --purge --yes   # deletes the scratch copy only
```

- **Use the same embedder as the store the snapshot came from** (OpenAI for a
  Supabase store), or semantic search will not find anything; the documents
  and keyword search work either way.
- A snapshot from a store with `CEREFOX_ENV_LABEL` set (`lan` above) makes the
  restore warn that it comes from another environment. That is expected here.
- Run the `export` in its own terminal and close it afterwards, so the next
  `cerefox-local` command reaches your real install again.
