/// <reference types="cypress" />

describe('Certificate DNS credentials update', () => {
	let token;
	let certID;

	const originalCreds = 'dns_cloudflare_api_token = ORIGINAL_TOKEN';
	const updatedCreds = 'dns_cloudflare_api_token = UPDATED_TOKEN';

	before(() => {
		cy.resetUsers();
		cy.getToken().then((tok) => {
			token = tok;
		});
	});

	it('Setup: insert a fake LE DNS certificate and credentials file', () => {
		cy.task('dbInsertDnsCertificate', {
			ownerUserId: 1,
			niceName: 'test-dns-edit',
			domainNames: ['test-dns-edit.example.com'],
			meta: {
				dns_challenge: true,
				dns_provider: 'cloudflare',
				dns_provider_credentials: originalCreds,
				propagation_seconds: 30,
				letsencrypt_agree: true,
				letsencrypt_email: 'cypress@example.com',
			},
		}).then((id) => {
			expect(id).to.be.greaterThan(0);
			certID = id;

			// Simulate the credentials file that requestLetsEncryptSslWithDnsChallenge
			// writes during initial certificate provisioning
			cy.task('writeCredentialsFile', {
				certId: certID,
				contents: originalCreds,
			});
		});
	});

	it('PUT updates credentials in the database', () => {
		cy.task('backendApiPut', {
			token: token,
			path: `/api/nginx/certificates/${certID}`,
			data: {
				meta: {
					dns_provider_credentials: updatedCreds,
				},
			},
		}).then((data) => {
			expect(data).to.have.property('id');
			expect(data.id).to.equal(certID);
			expect(data).to.have.property('provider', 'letsencrypt');
		});
	});

	it('GET returns the updated credentials', () => {
		cy.task('backendApiGet', {
			token: token,
			path: `/api/nginx/certificates/${certID}`,
		}).then((data) => {
			expect(data).to.have.property('id', certID);
			expect(data.meta).to.have.property('dns_provider', 'cloudflare');
			// dns_provider_credentials is stripped from API responses (omissions),
			// so we verify via the credentials file instead
		});
	});

	it('Credentials file on disk is updated for certbot renewal', () => {
		cy.task('readCredentialsFile', certID).then((contents) => {
			expect(contents).to.equal(updatedCreds);
		});
	});

	it('Cleanup', () => {
		cy.task('deleteCredentialsFile', certID);
		cy.task('dbDeleteCertificate', certID);
	});
});

describe('Certificate DNS batch replace', () => {
	let token;
	let certID1;
	let certID2;
	let certID3;

	const sharedCreds = 'dns_cloudflare_api_token = SHARED_TOKEN';
	const differentCreds = 'dns_cloudflare_api_token = DIFFERENT_TOKEN';
	const newCreds = 'dns_cloudflare_api_token = NEW_SHARED_TOKEN';

	before(() => {
		cy.resetUsers();
		cy.getToken().then((tok) => {
			token = tok;
		});
	});

	it('Setup: insert three LE DNS certificates (two sharing credentials, one different)', () => {
		cy.task('dbInsertDnsCertificate', {
			ownerUserId: 1,
			niceName: 'batch-cert-1',
			domainNames: ['batch1.example.com'],
			meta: {
				dns_challenge: true,
				dns_provider: 'cloudflare',
				dns_provider_credentials: sharedCreds,
				propagation_seconds: 30,
				letsencrypt_agree: true,
				letsencrypt_email: 'cypress@example.com',
			},
		}).then((id) => {
			certID1 = id;
			cy.task('writeCredentialsFile', { certId: id, contents: sharedCreds });
		});

		cy.task('dbInsertDnsCertificate', {
			ownerUserId: 1,
			niceName: 'batch-cert-2',
			domainNames: ['batch2.example.com'],
			meta: {
				dns_challenge: true,
				dns_provider: 'cloudflare',
				dns_provider_credentials: sharedCreds,
				propagation_seconds: 30,
				letsencrypt_agree: true,
				letsencrypt_email: 'cypress@example.com',
			},
		}).then((id) => {
			certID2 = id;
			cy.task('writeCredentialsFile', { certId: id, contents: sharedCreds });
		});

		cy.task('dbInsertDnsCertificate', {
			ownerUserId: 1,
			niceName: 'batch-cert-3-different',
			domainNames: ['batch3.example.com'],
			meta: {
				dns_challenge: true,
				dns_provider: 'cloudflare',
				dns_provider_credentials: differentCreds,
				propagation_seconds: 30,
				letsencrypt_agree: true,
				letsencrypt_email: 'cypress@example.com',
			},
		}).then((id) => {
			certID3 = id;
			cy.task('writeCredentialsFile', { certId: id, contents: differentCreds });
		});
	});

	it('GET batch-count returns correct count of sibling certificates', () => {
		cy.task('backendApiGet', {
			token: token,
			path: `/api/nginx/certificates/${certID1}/batch-count`,
		}).then((data) => {
			// certID2 shares credentials with certID1, certID3 does not
			expect(data).to.have.property('count', 1);
		});
	});

	it('PUT with batch_replace updates all sibling certificates', () => {
		cy.task('backendApiPut', {
			token: token,
			path: `/api/nginx/certificates/${certID1}`,
			data: {
				meta: {
					dns_provider_credentials: newCreds,
				},
				batch_replace: true,
			},
		}).then((data) => {
			expect(data).to.have.property('id', certID1);
			// batch_results should list certID2 as updated
			expect(data.batch_results).to.have.property('updated');
			expect(data.batch_results.updated).to.include(certID2);
			expect(data.batch_results.updated).to.not.include(certID3);
		});
	});

	it('Sibling credentials file is updated', () => {
		cy.task('readCredentialsFile', certID2).then((contents) => {
			expect(contents).to.equal(newCreds);
		});
	});

	it('Unrelated certificate credentials file is unchanged', () => {
		cy.task('readCredentialsFile', certID3).then((contents) => {
			expect(contents).to.equal(differentCreds);
		});
	});

	it('Cleanup', () => {
		cy.task('deleteCredentialsFile', certID1);
		cy.task('deleteCredentialsFile', certID2);
		cy.task('deleteCredentialsFile', certID3);
		cy.task('dbDeleteCertificate', certID1);
		cy.task('dbDeleteCertificate', certID2);
		cy.task('dbDeleteCertificate', certID3);
	});
});

describe('Certificate DNS validate (renew) with rollback', () => {
	let token;
	let certID;

	const originalCreds = 'dns_cloudflare_api_token = VALID_TOKEN';
	const badCreds = 'dns_cloudflare_api_token = BAD_TOKEN';

	before(() => {
		cy.resetUsers();
		cy.getToken().then((tok) => {
			token = tok;
		});
	});

	it('Setup: insert a fake LE DNS certificate', () => {
		cy.task('dbInsertDnsCertificate', {
			ownerUserId: 1,
			niceName: 'test-validate',
			domainNames: ['validate.example.com'],
			meta: {
				dns_challenge: true,
				dns_provider: 'cloudflare',
				dns_provider_credentials: originalCreds,
				propagation_seconds: 30,
				letsencrypt_agree: true,
				letsencrypt_email: 'cypress@example.com',
			},
		}).then((id) => {
			certID = id;
			cy.task('writeCredentialsFile', { certId: id, contents: originalCreds });
		});
	});

	it('PUT with validate=true fails (no certbot in test env) and rolls back', () => {
		cy.task('backendApiPut', {
			token: token,
			path: `/api/nginx/certificates/${certID}`,
			data: {
				meta: {
					dns_provider_credentials: badCreds,
				},
				validate: true,
			},
			returnOnError: true,
		}).then((result) => {
			// Expect failure since certbot is not available in the test environment
			expect(result).to.have.property('error');
		});
	});

	it('Credentials file is rolled back to original after failed validation', () => {
		cy.task('readCredentialsFile', certID).then((contents) => {
			expect(contents).to.equal(originalCreds);
		});
	});

	it('Database credentials are rolled back after failed validation', () => {
		cy.task('dbGetCertificateMeta', certID).then((meta) => {
			expect(meta.dns_provider_credentials).to.equal(originalCreds);
		});
	});

	it('Cleanup', () => {
		cy.task('deleteCredentialsFile', certID);
		cy.task('dbDeleteCertificate', certID);
	});
});
