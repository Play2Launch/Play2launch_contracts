# Run from PlayToLaunch_contracts. Uses the project's pinned Forge installation.
# PHOOD is already deployed; use verify-phood to publish its source, not deploy-phood.
NODE ?= node
AIRDROP_CONFIG ?= config/airdrop-phood-mainnet.json
.DEFAULT_GOAL := help
.PHONY: deploy-airdrop deploy-airdrop-check deploy-airdrop-testnet help build test deploy-phood verify-phood verify-phood-force verify-phood-command phood-status addresses

help:
	@echo "make deploy-airdrop-check  Validate AIRDROP_CONFIG without keys, RPC or transactions"
	@echo "make deploy-airdrop        Deploy/resume the configured airdrop and update DEPLOYED_CONTRACTS.txt"
	@echo "make deploy-airdrop-testnet Resume the existing local PHOOD testnet deployment"
	@echo "make verify-phood          Verify the existing mainnet PHOOD contract"
	@echo "make verify-phood-force    Skip Forge's already-verified precheck"
	@echo "make verify-phood-command  Print verification command without submitting"
	@echo "make phood-status         Show the saved deployment record"
	@echo "make addresses            Refresh the annotated deployed contract address list"
	@echo "make deploy-phood         Deploy/resume using the existing transaction journal"

build:
	$(NODE) node_modules/@foundry-rs/forge/bin.mjs build

test:
	$(NODE) node_modules/@foundry-rs/forge/bin.mjs test

# Reads .secrets/mainnet-deployer.json locally; never passes the key on the command line.
# Reuses deployments/4663/phood/deployment.json. Do not delete the journal to retry.
deploy-phood: build
	$(NODE) script/deploy-mainnet-phood.mjs

# Reads address, compiler version and constructor arguments from the deployment record.
# No private key or wallet transaction is required for source verification.
verify-phood:
	$(NODE) script/verify-mainnet-phood.mjs

verify-phood-force:
	$(NODE) script/verify-mainnet-phood.mjs --skip-is-verified-check

verify-phood-command:
	$(NODE) script/verify-mainnet-phood.mjs --dry-run

phood-status:
	$(NODE) -e "console.log(JSON.stringify(require('./deployments/4663/phood/deployment.json'), null, 2))"

addresses:
	$(NODE) script/update-deployed-contracts.mjs

# Default: prepared PHOOD mainnet config. For another activity, copy config/airdrop.example.json.
# Example: make deploy-airdrop AIRDROP_CONFIG=config/airdrop.json
# Keys stay in .secrets/*.json; never supply a private key in Make arguments.
# Reuse the same deploymentName to resume; use a NEW name for a different deployment.
deploy-airdrop-check:
	$(NODE) script/deploy-airdrop.mjs --config="$(AIRDROP_CONFIG)" --dry-run

deploy-airdrop: build
	$(NODE) script/deploy-airdrop.mjs --config="$(AIRDROP_CONFIG)"

# Historical testnet helper is bound to local activity cp2azzme0n5534.
# Do not use it for an activity with a different database ID, even if its slug is phood.
deploy-airdrop-testnet: build
	$(NODE) script/deploy-testnet-airdrop.mjs
