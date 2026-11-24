# 数据库初始化

mongo shell or mongo-init.js

```js
use sky-heart-note
db.createUser({
 user: "sky_heart",
 pwd: passwordPrompt(),
 roles: [
    { role: "readWrite", db: "sky-heart-note" }
  ]
})
```
