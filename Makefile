PORT ?= 8000
URL := http://localhost:$(PORT)

.DEFAULT_GOAL := help
.PHONY: help start stop restart

help: ## Affiche la liste des commandes
	@echo "Appart Gobelins — commandes :"
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  make \033[1m%-10s\033[0m %s\n", $$1, $$2}'

start: ## Lance l'app en local sur http://localhost:8000 (PORT=xxxx pour changer)
	@if lsof -ti tcp:$(PORT) >/dev/null 2>&1; then \
		echo "Déjà lancé sur $(URL)"; \
	else \
		nohup npx --yes http-server -p $(PORT) -c-1 >/dev/null 2>&1 & \
		sleep 1; \
		echo "App lancée sur $(URL)"; \
	fi
	@open $(URL)

stop: ## Arrête le serveur local
	@pids=$$(lsof -ti tcp:$(PORT)); \
	if [ -n "$$pids" ]; then kill $$pids && echo "Serveur arrêté (port $(PORT))"; \
	else echo "Rien à arrêter sur le port $(PORT)"; fi

restart: ## Relance le serveur local
	@$(MAKE) --no-print-directory stop
	@$(MAKE) --no-print-directory start
