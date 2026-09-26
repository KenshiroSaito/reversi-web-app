import { assertTestDatabase } from "../support/testDatabase";

// Runs in every integration test worker before any test file is loaded.
assertTestDatabase(process.env);
