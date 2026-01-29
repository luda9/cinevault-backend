const Koa = require('koa')
const bodyParser = require('koa-bodyparser')
const Router = require('koa-router')
const cors = require('@koa/cors')

const apiRoutes = require('./routes/api')

const app = new Koa()
const router = new Router()

require('dotenv').config()
app.use(cors({
  origin: process.env.CLIENT_URL,
  credentials: true,
}))

app.use(bodyParser())

router.use('/api', apiRoutes.routes())

app.use(router.routes())
app.use(router.allowedMethods())

module.exports = app
