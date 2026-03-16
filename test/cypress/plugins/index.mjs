import { SwaggerValidation } from "@jc21/cypress-swagger-validation";
import fs from "node:fs";
import chalk from "chalk";
import Database from "better-sqlite3";
import backendTask from "./backendApi/task.mjs";

export default (on, config) => {
	// Replace swaggerBase config var wildcard
	if (typeof config.env.swaggerBase !== "undefined") {
		config.env.swaggerBase = config.env.swaggerBase.replace(
			"{{baseUrl}}",
			config.baseUrl,
		);
	}

	const dbPath = config.env.npmDataDir
		? `${config.env.npmDataDir}/database.sqlite`
		: "/data/database.sqlite";

	const leDir = config.env.npmLeDir || "/etc/letsencrypt";

	// Plugin Events
	on("task", SwaggerValidation(config));
	on("task", backendTask(config));
	on("task", {
		log(message) {
			console.log(
				`${chalk.cyan.bold("[")}${chalk.blue.bold("LOG")}${chalk.cyan.bold("]")} ${chalk.red.bold(message)}`,
			);
			return null;
		},

		/**
		 * Insert a fake LE DNS certificate row into the database.
		 * Returns the inserted row id.
		 */
		dbInsertDnsCertificate({ ownerUserId, niceName, domainNames, meta }) {
			const db = new Database(dbPath);
			const stmt = db.prepare(`INSERT INTO certificate (
				created_on, modified_on, owner_user_id, is_deleted,
				provider, nice_name, domain_names, expires_on, meta
			) VALUES (
				datetime('now'), datetime('now'), ?, 0,
				'letsencrypt', ?, ?, datetime('now', '+60 days'), ?
			)`);
			const result = stmt.run(
				ownerUserId,
				niceName,
				JSON.stringify(domainNames),
				JSON.stringify(meta),
			);
			db.close();
			return result.lastInsertRowid;
		},

		/**
		 * Get the raw meta JSON for a certificate (including credentials).
		 */
		dbGetCertificateMeta(id) {
			const db = new Database(dbPath);
			const row = db.prepare("SELECT meta FROM certificate WHERE id = ?").get(id);
			db.close();
			return row ? JSON.parse(row.meta) : null;
		},

		/**
		 * Delete a certificate row by id.
		 */
		dbDeleteCertificate(id) {
			const db = new Database(dbPath);
			db.prepare("DELETE FROM certificate WHERE id = ?").run(id);
			db.close();
			return null;
		},

		/**
		 * Write a credentials file to the letsencrypt directory.
		 */
		writeCredentialsFile({ certId, contents }) {
			const dir = `${leDir}/credentials`;
			fs.mkdirSync(dir, { recursive: true });
			const filePath = `${dir}/credentials-${certId}`;
			fs.writeFileSync(filePath, contents, { mode: 0o600 });
			return filePath;
		},

		/**
		 * Read a credentials file. Returns its contents or null if missing.
		 */
		readCredentialsFile(certId) {
			const filePath = `${leDir}/credentials/credentials-${certId}`;
			try {
				return fs.readFileSync(filePath, "utf8");
			} catch {
				return null;
			}
		},

		/**
		 * Delete a credentials file.
		 */
		deleteCredentialsFile(certId) {
			const filePath = `${leDir}/credentials/credentials-${certId}`;
			try { fs.unlinkSync(filePath); } catch { /* ignore */ }
			return null;
		},
	});

	return config;
};
