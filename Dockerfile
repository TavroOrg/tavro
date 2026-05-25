FROM postgres:15

ENV POSTGRES_USER=admin
ENV POSTGRES_PASSWORD=admin
ENV POSTGRES_DB=agent_db

# Copy full SQL tree
COPY sql/ /docker-entrypoint-initdb.d/sql/

# Generate the runner script fresh during build — always LF, never CRLF
RUN printf '#!/bin/sh\n\
set -eu\n\
SQL_ROOT="/docker-entrypoint-initdb.d/sql"\n\
echo "Running SQL scripts from ${SQL_ROOT}..."\n\
if [ -f "${SQL_ROOT}/tavro_init_extensions.sql" ]; then\n\
  echo "Executing ${SQL_ROOT}/tavro_init_extensions.sql"\n\
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "${SQL_ROOT}/tavro_init_extensions.sql"\n\
fi\n\
for sql in $(find "${SQL_ROOT}" -type f -name "*.sql" | sort); do\n\
  if [ "$sql" = "${SQL_ROOT}/tavro_init_extensions.sql" ]; then\n\
    continue\n\
  fi\n\
  echo "Executing $sql"\n\
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$sql"\n\
done\n\
echo "All SQL scripts completed."\n' \
> /docker-entrypoint-initdb.d/02_run_all_sql.sh \
&& chmod +x /docker-entrypoint-initdb.d/02_run_all_sql.sh
