# Inventory ERP - Windows GNU Make commands
# Put this file beside server.py in E:\New_folder\inventory_erp

PYTHON = .venv\Scripts\python.exe
BACKUP ?= erp-backup.zip

.PHONY: help setup install tray-install run tray backup

help:
	@echo Available commands:
	@echo   make setup         - create virtual environment and install ERP dependencies
	@echo   make install       - install/update ERP dependencies
	@echo   make tray-install  - install tray icon dependencies
	@echo   make run           - run ERP in a visible terminal
	@echo   make tray          - start ERP hidden in the system tray
	@echo   make backup        - back up database to erp-backup.zip
	@echo   make backup BACKUP=my-backup.zip - choose backup filename

setup:
	python -m venv .venv
	$(PYTHON) -m pip install -r requirements.txt
	$(PYTHON) -m pip install pystray Pillow

install:
	$(PYTHON) -m pip install -r requirements.txt

tray-install:
	$(PYTHON) -m pip install pystray Pillow

run:
	$(PYTHON) server.py


# Refuses to overwrite an existing backup; choose another BACKUP filename.
backup:
	$(PYTHON) backup_database.py --output "$(BACKUP)"
