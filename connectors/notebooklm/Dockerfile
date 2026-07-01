# NotebookLM MCP connector — thin containerized wrapper around the unofficial
# `notebooklm-mcp` (PleasePrompto). Runs headless behind ContextForge, exposes
# an HTTP MCP endpoint on the internal `connectors` network, and reaches
# Google over the `egress` network only.
#
# Auth model: a persistent Chrome profile (Patchright) lives on the /data
# volume. Seed it ONCE (see README), then every run is fully headless — no
# cookie-file scraping, so the __Secure-*PSIDTS rotation problem does not occur.
#
# Read-only is enforced at the connector itself (NOTEBOOKLM_DISABLED_TOOLS +
# NOTEBOOKLM_PROFILE=minimal), so mutation tools are physically unavailable to
# the agent — independent of any prompt-level instruction.

# Playwright base carries all Chromium system libraries (fonts, libnss, …).
FROM mcr.microsoft.com/playwright:v1.55.0-noble

ARG NOTEBOOKLM_MCP_VERSION=2.0.0
ENV NODE_ENV=production

# Persistent state (Chrome profile + connector settings.json) resolves under
# these XDG roots via env-paths → /data/notebooklm-mcp/. Mount a volume at /data.
ENV XDG_DATA_HOME=/data \
    XDG_CONFIG_HOME=/data \
    XDG_CACHE_HOME=/data/cache

# Safe defaults baked in; runtime env_file may override non-secret values.
ENV HEADLESS=true \
    BROWSER_CHANNEL=chromium \
    NOTEBOOKLM_TRANSPORT=http \
    NOTEBOOKLM_HOST=0.0.0.0 \
    NOTEBOOKLM_PORT=3000 \
    NOTEBOOKLM_PROFILE=minimal \
    NOTEBOOKLM_DISABLED_TOOLS="add_source,add_notebook,update_notebook,remove_notebook,generate_audio,download_audio,cleanup_data,setup_auth,re_auth,select_notebook,close_session,reset_session"

RUN npm install -g "notebooklm-mcp@${NOTEBOOKLM_MCP_VERSION}" \
    && npx --yes patchright install chromium

RUN mkdir -p /data && chown -R pwuser:pwuser /data
VOLUME /data
USER pwuser

EXPOSE 3000

# Liveness: the HTTP transport accepts POST /mcp; a bare GET returns a
# non-connection-refused status once the server is up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.NOTEBOOKLM_PORT||3000)+'/mcp',{method:'GET'}).then(r=>process.exit(0)).catch(()=>process.exit(1))"

CMD ["notebooklm-mcp"]
