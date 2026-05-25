ARG ZITADEL_VERSION=v4.13.0

FROM ghcr.io/zitadel/zitadel-login:${ZITADEL_VERSION}

COPY tavro_app/src/assets/tavro-login-logo.svg /app/apps/login/public/tavro-login-logo.svg
COPY tavro_app/public/travo_logo.png /app/apps/login/public/favicon.png
COPY iam/customize-zitadel-login.mjs /tmp/customize-zitadel-login.mjs

RUN find /app/apps/login -type f \( -name '*.js' -o -name '*.json' \) \
    -exec sed -i \
      -e 's/"loginname":"Loginname"/"loginname":"Username"/g' \
      -e 's/labels\.loginname/labels.username/g' \
      {} +

RUN node /tmp/customize-zitadel-login.mjs
