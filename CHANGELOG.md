# [0.19.0](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.18.1...0.19.0) (2023-01-12)


### Features

* add update-external-order-nos to manual update fns ([1b9ff7e](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/1b9ff7ed66145b8a9983a25d32f2b6afab3affaa))

## [0.18.1](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.18.0...0.18.1) (2023-01-12)


### Bug Fixes

* contract-extend message bug ([0b5187d](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/0b5187ddf2c3d84ef28ae3094d7b776205a9de0b))

# [0.18.0](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.17.0...0.18.0) (2023-01-12)


### Features

* try to send email before extending contract, so that it only extends if customer is notified succesfully ([4240936](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/4240936f2a5009b5bb424e001c0b22ac210c4d82))

# [0.17.0](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.16.0...0.17.0) (2023-01-12)


### Features

* contract extend emails, invoice resend emails, gradual price jobs ([5a3530b](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/5a3530b934a356dd5afed01f877caf393b2e30ab))

# [0.16.0](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.15.0...0.16.0) (2023-01-11)


### Features

* allow sending auto-invoices ([2b52055](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/2b520551dfe7b58e3b30182afaa3b756ce6df9fb))
* regenerate invoices (for when biling cycle changes) ([43e2e8d](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/43e2e8d9191759d1c40c3d2f47b9ad042eeb7d07))

# [0.15.0](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.14.2...0.15.0) (2023-01-11)


### Bug Fixes

* missing params from contract refresh fn ([b82836f](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/b82836f5bd45a86d7afadf89f8686c57467018b5))


### Features

* add manual update function for contract updates ([338a95c](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/338a95cce146a4d5aa5c72bea7d6f4ab7a5d4cbc))

## [0.14.2](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.14.1...0.14.2) (2023-01-11)


### Bug Fixes

* password reset email ([cdcee2a](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/cdcee2ab5ee202ea98ba6f74880113151d167cc2))

## [0.14.1](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.14.0...0.14.1) (2023-01-11)


### Bug Fixes

* rollback semantic (node version incompatible) ([1ef0f32](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/1ef0f32d2e27512b33a1cb33665363ac78170223))

# [0.14.0](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.13.4...0.14.0) (2023-01-11)


### Features

* validate credit note and invoice dates, checking future and previous year documents ([768734a](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/768734a9f5918d9f86eadab5ac5e3fe4374f7a7d))

## [0.13.4](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.13.3...0.13.4) (2023-01-10)


### Bug Fixes

* contract-cancel disassembly bug ([ca508c7](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/ca508c7369269fe8298b1cb597bcd2e039d93230))

## [0.13.3](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.13.2...0.13.3) (2023-01-10)


### Bug Fixes

* email code ([d1783fb](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/d1783fbe59e6544d6ef23143be282f0acd7d8129))

## [0.13.2](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.13.1...0.13.2) (2023-01-10)


### Bug Fixes

* bug in paymentType normalizer ([fc1ad26](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/fc1ad26346fcfbcdf4f15802fda67915008f6225))

## [0.13.1](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.13.0...0.13.1) (2023-01-10)


### Bug Fixes

* **deps:** update dependency @googlemaps/google-maps-services-js to v3.3.26 ([003293c](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/003293ca8be09efc76284c838a3eee0f6e154323))

# [0.13.0](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.12.1...0.13.0) (2023-01-09)


### Features

* production fixes and totals ([480c7b6](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/480c7b6a7be8e6a832016f2fcbf039ae5b9eb2a4))

## [0.12.1](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.12.0...0.12.1) (2023-01-09)


### Bug Fixes

* contract commissions normalizer bug ([9f47d00](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/9f47d00d66f7b7d80c2337f2a2dcd4c68ee6e16e))

# [0.12.0](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.11.0...0.12.0) (2023-01-09)


### Features

* add companyId to search if booked filter present ([206054a](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/206054adb94f3a9c117252020a2c7314dc8395f8))
* disable end/extend/issue jobs ([0363e8b](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/0363e8b7ae59b08f3d7e078406362e94bf46094d))

# [0.11.0](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.10.0...0.11.0) (2023-01-09)


### Features

* remove redis from triggers ([0185b25](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/0185b25760933361eaa4eb74a18f250f15bc39b6))

# [0.10.0](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.9.9...0.10.0) (2023-01-09)


### Features

* remove redis from cube afterFind ([91c0e4d](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/91c0e4d50b1a3c5ff0609442716bd9b0f181bb06))

## [0.9.9](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.9.8...0.9.9) (2023-01-09)


### Bug Fixes

* attempt to log redis events ([0e7f929](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/0e7f929a489505bab3ba5d9838785e670c555274))

## [0.9.8](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.9.7...0.9.8) (2023-01-09)


### Bug Fixes

* attempt disabling maxRetries and enableReachCheck from redis options ([527152b](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/527152b6f8093eac7cac5ad028cf093cb17803d9))

## [0.9.7](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.9.6...0.9.7) (2023-01-09)


### Bug Fixes

* test 10 thousand sismember queries ([fb1de24](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/fb1de248f3870d663bc7949fb99ac3278747d306))

## [0.9.6](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.9.5...0.9.6) (2023-01-09)


### Bug Fixes

* revert separateProcess in queues ([f6e1ae9](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/f6e1ae90db92f68649ac83eed092d75961c5acf8))

## [0.9.5](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.9.4...0.9.5) (2023-01-09)


### Bug Fixes

* re-introduce redis query in after find cubes ([ea224b9](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/ea224b9a4e8672148d8c311685258333ac5d8247))

## [0.9.4](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.9.3...0.9.4) (2023-01-09)


### Bug Fixes

* re-introduce afterFind, without media fetch and without redis ([c2f128b](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/c2f128bc29d3651f1725a6940aaef8c5e7e2348f))

## [0.9.3](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.9.2...0.9.3) (2023-01-09)


### Bug Fixes

* attempt to disable afterFind completely ([3a50ff6](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/3a50ff6f91e2b93e2d9c97e41db94674d5031281))

## [0.9.2](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.9.1...0.9.2) (2023-01-09)


### Bug Fixes

* attempt to remove redis query per cube in cubes afterfind ([be22637](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/be22637b5b7d6b58c2ef9b9bee8d92e0a776b170))

## [0.9.1](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.9.0...0.9.1) (2023-01-09)


### Bug Fixes

* metadata encoding error with aws ([480f3d2](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/480f3d29af1cdecad558cca6b6e495738603cea9))

# [0.9.0](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.8.6...0.9.0) (2023-01-09)


### Features

* move seed files and use file read ([8f10ba0](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/8f10ba03c94a57048228a3480d77235188b1bae8))

## [0.8.6](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.8.5...0.8.6) (2023-01-09)


### Bug Fixes

* seed without uploading files ([85b8410](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/85b841012882fe0857310848166e2797aeb0c3c4))

## [0.8.5](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.8.4...0.8.5) (2023-01-09)


### Bug Fixes

* attempt to only encode filename on Parse.File creation and encode the metadata in beforeSave hook ([d0448fa](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/d0448fad38334103e4715d547207c36228746f60))

## [0.8.4](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.8.3...0.8.4) (2023-01-09)


### Bug Fixes

* attempt to fix filename error by encoding both filename and metadata at housing-type seed level ([79fbe02](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/79fbe02e0e51d5dcf09eada043f846d162393f87))

## [0.8.3](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.8.2...0.8.3) (2023-01-09)


### Bug Fixes

* increase limits during seed ([eb445bb](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/eb445bb5d9c993c363b0649409f6ebe09954b636))

## [0.8.2](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.8.1...0.8.2) (2023-01-09)


### Bug Fixes

* attempt to also encode metadata filename ([fe9b255](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/fe9b255e3ad239f3aa7f21963e303025ab33d30e))

## [0.8.1](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.8.0...0.8.1) (2023-01-09)


### Bug Fixes

* log housing types in seed ([5582d76](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/5582d769233e35f07dd33db2b21e4f7411f92af5))

# [0.8.0](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.7.0...0.8.0) (2023-01-09)


### Features

* add separate seeds ([96204de](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/96204dee6ae69a5b82320e2f90739d1939bc8a11))

# [0.7.0](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.6.0...0.7.0) (2023-01-09)


### Features

* add redis cache and separate databases ([e2bc604](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/e2bc60473243aad56453add5b5f83dc9ac9291ce))

# [0.6.0](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.5.4...0.6.0) (2023-01-09)


### Features

* enable schema hooks, remove enableSingleSchemaCache ([dbf1a16](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/dbf1a167bcd0d59fb1335ba29e5d3d6fbdb119a2))

## [0.5.4](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.5.3...0.5.4) (2023-01-08)


### Bug Fixes

* aws encodeUriComponent in filename ([ced0a6e](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/ced0a6ef1ab1e888b1d2d79a23e89941ee569ea1))

## [0.5.3](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.5.2...0.5.3) (2023-01-08)


### Bug Fixes

* docs enums require ([5754ce6](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/5754ce6470552fda4f35b2c2fa87766da61881cd))

## [0.5.2](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.5.1...0.5.2) (2023-01-08)


### Bug Fixes

* print package files enums require bug ([4515372](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/4515372913c7d531415a346fac429faa15fc5ca0))

## [0.5.1](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.5.0...0.5.1) (2023-01-08)


### Bug Fixes

* parse object metadata boolean bug with aws adapter ([405d43c](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/405d43cb85f036385ef0565a938d316f544f27a0))

# [0.5.0](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.4.1...0.5.0) (2023-01-08)


### Features

* install imagemagick into docker base image node 16 ([c54e5a6](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/c54e5a6eaf2d4fcf23a6d117768d5dea7b6824e7))

## [0.4.1](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.4.0...0.4.1) (2023-01-08)


### Bug Fixes

* separate enums from init dictionary to save bandwith ([e27f5ca](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/e27f5cacf92cc5b5f179fbc7395b8906b11888eb))

# [0.4.0](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.3.0...0.4.0) (2023-01-08)


### Features

* add seed jsons ([019c7ad](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/019c7ad12c445a7ab7582e740b32a9e5c54a2585))
* initialize main code ([3dc81f7](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/3dc81f777b4112fafff7a46f94d420c2ab655bb8))

# [0.3.0](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.2.3...0.3.0) (2023-01-03)


### Bug Fixes

* **deps:** pin dependency @googlemaps/google-maps-services-js to 3.3.16 ([6a3e9c7](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/6a3e9c7d0e8b0d351901d78d5a9e709494794baa))


### Features

* add cube schema for initial import ([6287423](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/6287423e06589b8e18a8b35ee8f44476da0fa141))

## [0.2.3](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.2.2...0.2.3) (2023-01-01)


### Bug Fixes

* remove $price from eslintignore ([ce3a69e](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/ce3a69e59497e750cd767f6ef19f989eddf12d1c))

## [0.2.2](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.2.1...0.2.2) (2023-01-01)


### Bug Fixes

* Use json key for google auth ([6db68e4](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/6db68e4362aa4cca83ccb21c973a008ddd15ea7a))

## [0.2.1](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.2.0...0.2.1) (2023-01-01)


### Bug Fixes

* make sure to consola.error service test errors ([f824a86](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/f824a8669d8d622fdc71ba50bfeeb3ff0f996ad3))

# [0.2.0](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.1.5...0.2.0) (2023-01-01)


### Features

* add google services and tests ([203e16c](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/203e16c873873b2a918dd93399b15d17cef95369))

## [0.1.5](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.1.4...0.1.5) (2022-12-26)


### Bug Fixes

* add testing for elastic, lex and redis ([1d580bd](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/1d580bd24a194153696312fd392cb1d1b0989ce3))

## [0.1.4](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.1.3...0.1.4) (2022-12-26)


### Bug Fixes

* show successful subscriptions to lex ensure ([f05c3fd](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/f05c3fdb656b3e91ae7d6690b417ae17d89b301b))

## [0.1.3](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.1.2...0.1.3) (2022-12-26)


### Bug Fixes

* elastic and lex testing ([4baf47e](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/4baf47e6b00cd8ec5e3dbefff54bb5589df9f327))

## [0.1.2](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.1.1...0.1.2) (2022-12-26)


### Bug Fixes

* add lexoffice todo ([88319ef](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/88319ef1c2cdaddb65dc0434eb0202e0daa3e320))

## [0.1.1](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.1.0...0.1.1) (2022-12-26)


### Bug Fixes

* add elastic ([753a1df](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/753a1df958030271ced6e65bcff644a2a89846d8))

# [0.1.0](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.0.11...0.1.0) (2022-12-26)


### Features

* add connection-tests, lex, elastic and redis ([18da6bb](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/18da6bb63c1be35f235a58f0d9a3aedae7a5f671))

## [0.0.11](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.0.10...0.0.11) (2022-12-24)


### Bug Fixes

* **deps:** update dependency sharp to v0.31.3 ([9557e0f](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/9557e0f0eaba272b1994d892277a4ac2324cf2a3))

## [0.0.10](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.0.9...0.0.10) (2022-12-04)


### Bug Fixes

* **deps:** pin dependencies ([c082373](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/c082373116f87f3da0bbe03befaac4784a199d76))

## [0.0.9](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.0.8...0.0.9) (2022-11-29)


### Bug Fixes

* fix ingress ([c01a9e7](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/c01a9e7e30851efbc12f5a39bccbb4adf1ad546b))

## [0.0.8](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.0.7...0.0.8) (2022-11-29)


### Bug Fixes

* remove rewrite target from ingress completely ([2da1e49](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/2da1e492ac10506a36710cd056e9e674b369ecbd))

## [0.0.7](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.0.6...0.0.7) (2022-11-29)


### Bug Fixes

* remove additional ingresses, expose all at / ([1402d6f](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/1402d6f2fbf6021a57ad51290bd8a72f1d25545c))

## [0.0.6](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.0.5...0.0.6) (2022-11-29)


### Bug Fixes

* wait another second before initializing app ([d282241](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/d28224183184e4296d346dce141062a402e2a7f9))

## [0.0.5](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.0.4...0.0.5) (2022-11-29)


### Bug Fixes

* await redis connection ([c490182](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/c490182f72b262ac77aa908d88792e2a65ac80c0))

## [0.0.4](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.0.3...0.0.4) (2022-11-29)


### Bug Fixes

* rename probe to healthz ([321f755](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/321f75531c40b2676b6e5d127ae1dd1b095f866c))

## [0.0.3](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.0.2...0.0.3) (2022-11-29)


### Bug Fixes

* add secret values ([e2102e0](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/e2102e0781e3b2ac17e8dccf854425e45fc1a06f))

## [0.0.2](https://github.com/mammutmedia/rheinkultur-wawi-parse/compare/0.0.1...0.0.2) (2022-11-29)


### Bug Fixes

* googlekey from file ([4a46f68](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/4a46f68392a93151be983a9ad6af60959c749958))

# 1.0.0 (2022-11-29)


### Bug Fixes

* add semantics ([220a0c5](https://github.com/mammutmedia/rheinkultur-wawi-parse/commit/220a0c5e6b185eed1601284d6e8b6e7ed23f1b94))
