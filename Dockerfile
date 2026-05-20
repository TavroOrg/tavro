FROM postgres:15

ENV POSTGRES_USER=admin
ENV POSTGRES_PASSWORD=admin
ENV POSTGRES_DB=agent_db

# Copy schema file and subfolders separately
COPY sql/01_create_schemas.sql /docker-entrypoint-initdb.d/01_create_schemas.sql
COPY sql/core/            /docker-entrypoint-initdb.d/core/
COPY sql/curated/         /docker-entrypoint-initdb.d/curated/
COPY sql/raw/             /docker-entrypoint-initdb.d/raw/
COPY sql/risk_management/ /docker-entrypoint-initdb.d/risk_management/

# Generate the runner script fresh during build — always LF, never CRLF
RUN printf '#!/bin/sh\n\
set -eu\n\
echo "Running SQL scripts from subfolders..."\n\
for sql in $(find /docker-entrypoint-initdb.d -mindepth 2 -name "*.sql" | sort); do\n\
  echo "Executing $sql"\n\
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$sql"\n\
done\n\
echo "All scripts completed."\n' \
> /docker-entrypoint-initdb.d/02_run_all_sql.sh \
&& chmod +x /docker-entrypoint-initdb.d/02_run_all_sql.sh