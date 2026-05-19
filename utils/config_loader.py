import os
from pathlib import Path
from typing import Any, Dict

import yaml


def _read_yaml(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        loaded = yaml.safe_load(f) or {}

    if not isinstance(loaded, dict):
        raise ValueError(f"Configuration file {path} must contain a YAML object at the root.")

    return loaded


def load_config(config_path: str | None = None) -> Dict[str, Any]:
    """
    Load configuration with fallback order:
    1. Explicit function argument
    2. CATALOG_CONFIG_PATH environment variable
    3. ./config.yaml
    4. ./config.yaml.example
    """
    candidate_paths = []

    if config_path:
        candidate_paths.append(Path(config_path))

    env_path = os.environ.get("CATALOG_CONFIG_PATH")
    if env_path:
        candidate_paths.append(Path(env_path))

    candidate_paths.extend([Path("config.yaml"), Path("config.yaml.example")])

    seen = set()
    for path in candidate_paths:
        resolved = path.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)

        if path.exists() and path.is_file():
            config = _read_yaml(path)
            print(f"Configuration loaded from: {path}")
            return config

    searched = ", ".join(str(p) for p in candidate_paths)
    raise FileNotFoundError(
        "Unable to find a configuration file. "
        f"Looked in: {searched}. "
        "Create config.yaml from config.yaml.example."
    )


if __name__ == "__main__":
    load_config()
