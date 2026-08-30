# Monitoreo en vivo del `.exe`

Activado el 2026-08-29 a pedido explícito, para poder ver en tiempo real lo
que hace `shelra.exe` mientras se corren pruebas desde `live-tasks/`.

## Qué se activó

1. **Logging estructurado a archivo, nivel `debug`.** Variables de entorno de
   usuario (persistentes, sobreviven a cerrar la terminal):
   - `SHELRACODE_LOG_LEVEL=debug`
   - `SHELRACODE_LOG_PATH=D:\PROYECTS\shelra\live-tasks\.logs\shelracode.log`

   Se aplican automáticamente a cualquier proceso nuevo (terminal nueva,
   doble-click al `.exe`, etc.) via `[Environment]::SetEnvironmentVariable`
   con scope `User`. No hace falta configurar nada manualmente antes de
   correr una tarea.

2. **`dist/shelra.exe` reconstruido** con todo el trabajo del 2026-08-29
   (aislamiento OS Fase 12 + los 8 fixes de seguridad), e instalado como
   comando global `shelra` (`C:\Users\Javie\.shelra\bin\shelra.exe`, en
   PATH de usuario — abrí una terminal nueva para que tome el PATH).

3. **Monitor en vivo** sobre el archivo de log, filtrando a nivel
   `info`/`warn`/`error` (el archivo en disco tiene el detalle completo en
   `debug`, incluyendo cada llamada a herramienta y cada spawn de proceso;
   el filtro es solo para no inundar de eventos rutinarios).

## Verificado funcionando

Corrida de prueba (`shelra.exe doctor`) confirmó el pipeline completo:
proceso → escribe al log → el monitor lo levanta en vivo. Se vieron eventos
reales: `storage.opened`, `control-plane.opened` con el root/ruta de estado/
modo de ruteo detectados correctamente.

## Cómo revisar el log manualmente

El archivo completo (nivel `debug`, todo el detalle) queda en:

```
live-tasks/.logs/shelracode.log
```

Es JSON Lines (un objeto JSON por línea: `timestamp`, `level`, `event`,
`context`, `data`). Se puede filtrar por evento, componente, nivel, etc. con
cualquier herramienta de línea de comandos o abrirlo directo.

## Si hace falta desactivar

```powershell
[Environment]::SetEnvironmentVariable("SHELRACODE_LOG_LEVEL", $null, "User")
[Environment]::SetEnvironmentVariable("SHELRACODE_LOG_PATH", $null, "User")
```
