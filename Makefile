.PHONY: api ui test

PY ?= .venv/bin/python
UVICORN ?= .venv/bin/uvicorn

api:
	$(UVICORN) app.main:app --app-dir backend --host 127.0.0.1 --port 8765

ui:
	cd frontend && npm run dev

test:
	$(PY) -m pytest
