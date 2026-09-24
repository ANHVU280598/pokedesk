.PHONY: api ui test start pull restart stop

PY ?= .venv/bin/python
UVICORN ?= .venv/bin/uvicorn

api:
	$(UVICORN) app.main:app --app-dir backend --host 127.0.0.1 --port 8765

ui:
	cd frontend && npm run dev

test:
	$(PY) -m pytest

start:
	./scripts/catalog-desk.sh start

pull:
	./scripts/catalog-desk.sh pull

restart:
	./scripts/catalog-desk.sh restart

stop:
	./scripts/catalog-desk.sh stop
