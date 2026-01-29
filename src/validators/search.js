const Joi = require('joi')

module.exports = Joi.object({
  s: Joi.string().min(1).required(),
  type: Joi.string().valid('movie', 'series', 'episode').optional(),
  y: Joi.number().integer().optional(),
  page: Joi.number().integer().min(1).max(100).optional()
})
