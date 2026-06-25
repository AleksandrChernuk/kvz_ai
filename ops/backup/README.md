# Backups & Logging

Self-hosting moves backup, rotation, and log management onto us. These are the
minimum safety nets.

## Backups (Postgres)

Dumps both databases: the Supabase app DB and the ContextForge gateway DB.

```bash
sudo ./ops/backup/backup-postgres.sh            # dump both, gzip, prune old
sudo RETENTION_DAYS=30 ./ops/backup/backup-postgres.sh
```

Output: `/opt/backups/postgres/<label>-<db>-<timestamp>.sql.gz`, kept 14 days.

### Cron (daily 03:30)

```bash
sudo crontab -e
# add:
30 3 * * * /opt/kvz-ai/current/ops/backup/backup-postgres.sh >> /opt/backups/postgres/backup.log 2>&1
```

### Always back up before a DB migration

```bash
sudo ./ops/backup/backup-postgres.sh
sudo ./ops/supabase/apply-migrations.sh
```

### Restore

```bash
sudo ./ops/backup/restore-postgres.sh supabase /opt/backups/postgres/supabase-postgres-<ts>.sql.gz
sudo ./ops/backup/restore-postgres.sh gateway  /opt/backups/postgres/gateway-contextforge-<ts>.sql.gz
```

Restore is destructive (`--clean`) — it takes no confirmation beyond the prompt.
Off-site copy: sync `/opt/backups/postgres/` to object storage (rclone/S3) so a
lost VPS does not lose the backups too.

## Logging

Two log surfaces:

| Surface | Source | Managed by |
|---|---|---|
| `/opt/kvz-ai/shared/logs/web,worker/*.log` | systemd `append:` from app/worker | `logrotate` |
| Docker container logs (Supabase, gateway) | json-file driver | docker `log-opts` |

### App/worker file logs — logrotate

```bash
sudo cp ops/logging/logrotate-kvz-ai.conf /etc/logrotate.d/kvz-ai
sudo logrotate --debug /etc/logrotate.d/kvz-ai   # dry run
```

Daily, 14 rotations, compressed, `copytruncate` (no service restart needed).

### Docker container logs — size cap

```bash
sudo cp ops/logging/daemon.json /etc/docker/daemon.json
sudo systemctl restart docker
# recreate containers so the limit applies:
cd /opt/supabase/kvz-ai && docker compose up -d
cd /opt/kvz-mcp-gateway && docker compose up -d
```

Caps each container at 20 MB × 5 files. Without this, a chatty container can
fill the disk.

### Reading logs day to day

```bash
journalctl -u kvz-ai-web -f               # if running under journald
tail -f /opt/kvz-ai/shared/logs/worker/worker.log
docker compose logs -f gateway            # from /opt/kvz-mcp-gateway
```
