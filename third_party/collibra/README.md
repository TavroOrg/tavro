Place the Linux Collibra `chip` binary here when building the dedicated Collibra MCP container image.

Expected default file path:

```text
third_party/collibra/chip-linux-amd64
```

Suggested steps:

1. Download the latest Linux AMD64 binary from the Collibra `chip` releases page.
2. Rename it to `chip-linux-amd64` if needed.
3. Rebuild the `collibra-mcp-server` image after updating the binary.

You can override the path with the `COLLIBRA_CHIP_BINARY_PATH` environment variable in `.env` or `env_sample.txt`.

If you are on Windows and using `chip.exe` directly on your host machine, you do not need to place anything in this folder.
In that case, keep `COLLIBRA_MCP_BASE_URL=http://host.docker.internal:8080` in `.env`, run `chip.exe` in HTTP mode on Windows, and let Tavro call it from the Docker container.
