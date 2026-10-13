.PHONY: dev fixture web-build demo test integration check deps migrate seed recovery compose-demo stop
dev:
	npm run dev
fixture:
	npm run fixture
web-build:
	npm run web-build
demo:
	npm run demo
test:
	npm test
	npm run api:test
integration:
	npm run test:integration
	npm run test:browser
check:
	npm run check
deps:
	npm run deps
migrate:
	npm run migrate
seed:
	npm run seed
recovery:
	npm run test:recovery
compose-demo:
	npm run compose:demo
stop:
	npm run stop
