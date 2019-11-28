import _ from 'lodash';
import Joi from 'joi';
import validate from 'express-validation';
import { middleware as tcMiddleware } from 'tc-core-library-js';
import models from '../../models';
import util from '../../util';

/**
 * API to list all project members.
 *
 */
const permissions = tcMiddleware.permissions;

const schema = {
  query: {
    fields: Joi.string().optional(),
  },
};

module.exports = [
  validate(schema),
  permissions('project.listMembers'),
  async (req, res, next) => {
    let fields = null;
    if (req.query.fields) {
      fields = req.query.fields.split(',');
    }
    try {
      const memberFields = _.keys(models.ProjectMember.attributes);
      const members = await util.getObjectsWithMemberDetails(
        req.context.currentProjectMembers, fields, {
          logger: req.log,
          requestId: req.id,
          memberFields,
        },
      );
      return res.json(util.wrapResponse(req.id, members));
    } catch (err) {
      return next(err);
    }
  },
];
