// The official Mongo image runs this once, before accepting network connections.
const password = process.env.SKY_MONGO_PASSWORD;
if (!password) throw new Error("Set DB_MONGO_PASSWORD before initializing MongoDB");
const database = db.getSiblingDB(process.env.MONGO_INITDB_DATABASE);
database.createUser({
  user: process.env.SKY_MONGO_USER,
  pwd: password,
  roles: [{ role: "readWrite", db: database.getName() }],
});
