import { db } from "shared";
import { ensureAssetIndexSchema, SqliteAssetIndex } from "@openinary/core";

const { ftsAvailable } = ensureAssetIndexSchema(db);

export const assetIndex = new SqliteAssetIndex(db, ftsAvailable);
