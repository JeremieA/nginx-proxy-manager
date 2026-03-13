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
