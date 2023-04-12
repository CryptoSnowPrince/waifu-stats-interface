# readme2

## env

```text
ubuntu20.04
node 14.21.3
```

## nginx config

```shell
location / {
  proxy_pass http://127.0.0.1:3105/;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_cache_bypass $http_upgrade;
}
```
## how to start

```shell
npm install
npm run build:prod
npm run start-server
```
