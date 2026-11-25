# 数据库初始化

mongo shell or mongo-init.js

```js
use sky-club
db.createUser({
 user: "sky-club",
 pwd: passwordPrompt(),
 roles: [
    { role: "readWrite", db: "sky-club" }
  ]
})
```
