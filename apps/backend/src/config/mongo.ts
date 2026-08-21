import { MongoClient, type Db } from "mongodb";

import { env } from "./env.js";

let client: MongoClient | undefined;
let database: Db | undefined;

export const isMongoConfigured = (): boolean => Boolean(env.mongoDbUri);

export const connectMongo = async (): Promise<Db> => {
  if (!env.mongoDbUri) {
    throw new Error("MONGODB_URI is not configured");
  }

  if (database) {
    return database;
  }

  client = new MongoClient(env.mongoDbUri);
  await client.connect();
  database = client.db();

  return database;
};

export const getMongoDb = (): Db | undefined => database;

export const closeMongo = async (): Promise<void> => {
  if (client) {
    await client.close();
  }

  client = undefined;
  database = undefined;
};
