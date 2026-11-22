# MECH50003 Coursework
## Numerical Solution of Black-Scholes Equation

Numerical solution of the Black-Scholes equation using explicit finite difference method and implicit Crank-Nicolson method, with analysis of the stability and convergence of the methods.
### Interactive page

An in-browser port of both schemes, with a live comparison against the analytic price, is at
<https://projects.thedylone.com/black-scholes-numerical/>. Its source is in [`web/`](web/):

```sh
cd web
npm install
npm test        # solver vs. analytic Black–Scholes
npm run dev
```
