**Service for Managing Huawei E3372h-607 Series Modems**

**Installation and Start-up**

1. `git clone git@github.com:volkish/arbiter.git`
2. `yarn install`
3. `yarn build`
4. `yarn start`

**Workflow**

1. Request a modem from the pool: `http://127.0.0.1:8080/acquire`
2. Return the modem to the pool: `http://127.0.0.1:8080/release?token=XXXXXXX`
