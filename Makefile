.PHONY: dev fixture web-build demo test integration check
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
integration:
	npm run test:browser
check:
	npm run check
