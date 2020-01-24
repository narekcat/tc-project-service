/* eslint-disable no-console */
/* eslint-disable consistent-return */
/* eslint-disable no-restricted-syntax */
/*
 * Compare the data from database and data from ES.
 * Specific to project-related data.
 *
 * Please consider decouple some reusable logics from this module before create
 * modules to compare other models.
 */

const Diff = require('jsondiffpatch');
const lodash = require('lodash');
const scriptUtil = require('./util');

const associations = {
  phases: 'Phase',
  members: 'Member',
  invites: 'Invite',
  attachments: 'Attachment',
};

const differ = Diff.create({
  objectHash: obj => obj.id,
});

/**
 * The json diff patch may contains deltas with same path,
 * one is "added to array", the other is "deleted from array".
 * In such case they can be combined and treated as "modified at an index in the array".
 *
 * @param {Array} deltas the data to be filtered
 * @returns {Array} filtered data
 */
function processSamePath(deltas) {
  const result = [];
  const groups = lodash.groupBy(deltas, 'path');
  for (const value of Object.values(groups)) {
    if (value.length === 1) {
      result.push(value[0]);
      continue; // eslint-disable-line no-continue
    }
    if (value.length === 2) {
      result.push(Object.assign({ type: 'modify' }, lodash.omit(value[0], 'type')));
      continue; // eslint-disable-line no-continue
    }
    throw new Error('Internal Error');
  }
  return result;
}

/**
 * Transform or filter deltas before any further proccess.
 *
 * @param {Array} deltas the data to be processed
 * @returns {Array} the result
 */
function preProcessDeltas(deltas) {
  return processSamePath(
    scriptUtil.flatten(deltas),
  );
}

/**
 * Process diff delta to extract project-related data.
 *
 * @param {Object} delta the diff delta. See `util.flatten()`
 * @param {Object} esData the data from ES
 * @param {Object} dbData the data from DB
 * @param {Object} finalData the data patched
 * @returns {Object} Object project diff delta in a specific data structure
 */
function processDelta(delta, esData, dbData, finalData) {
  const processMissingObject = (item, option) => {
    if (item.type === 'delete') {
      const projectId = lodash.get(dbData, lodash.slice(item.path, 0, 1)).id;
      console.log(`one dbOnly found for ${option.modelName} with id ${item.originalValue.id}`);
      return {
        type: 'dbOnly',
        projectId,
        modelName: option.modelName,
        id: item.originalValue.id,
        dbCopy: item.originalValue,
      };
    }
    if (item.type === 'add') {
      const projectId = lodash.get(esData, lodash.slice(item.path, 0, 1)).id;
      console.log(`one esOnly found for ${option.modelName} with id ${item.value.id}`);
      return {
        type: 'esOnly',
        projectId,
        modelName: option.modelName,
        id: item.value.id,
        esCopy: item.value,
      };
    }
  };

  const processProduct = (item) => {
    const subPath = lodash.slice(item.path, 4);
    if (item.dataType === 'array' && subPath.length === 1) {
      return processMissingObject(item, { modelName: 'Product' });
    }
    if (['add', 'delete', 'modify'].includes(item.type)) {
      const path = scriptUtil.generateJSONPath(lodash.slice(subPath, 1));
      const id = lodash.get(finalData, lodash.slice(item.path, 0, 5)).id;
      const projectId = lodash.get(finalData, lodash.slice(item.path, 0, 1)).id;
      const phaseId = lodash.get(finalData, lodash.slice(item.path, 0, 3)).id;
      const dbCopy = lodash.find(
        lodash.find(
          lodash.find(dbData, { id: projectId }).phases,
          { id: phaseId },
        ).products,
        { id },
      );
      const esCopy = lodash.find(
        lodash.find(
          lodash.find(esData, { id: projectId }).phases,
          { id: phaseId },
        ).products,
        { id },
      );
      console.log(`one mismatch found for Product with id ${id}`);
      return {
        type: 'mismatch',
        kind: item.type,
        dataType: item.dataType,
        projectId,
        id,
        modelName: 'Product',
        path,
        dbCopy,
        esCopy,
      };
    }
  };

  const processAssociation = (item, option) => {
    if (item.path[1] === 'phases' && item.path[3] === 'products') {
      return processProduct(item);
    }
    const subPath = lodash.slice(item.path, 2);
    if (item.dataType === 'array' && subPath.length === 1) {
      return processMissingObject(item, option);
    }
    if (['add', 'delete', 'modify'].includes(item.type)) {
      const path = scriptUtil.generateJSONPath(lodash.slice(subPath, 1));
      const id = lodash.get(finalData, lodash.slice(item.path, 0, 3)).id;
      const projectId = lodash.get(finalData, lodash.slice(item.path, 0, 1)).id;
      const dbCopy = lodash.find(
        lodash.find(dbData, { id: projectId })[option.refPath],
        { id },
      );
      const esCopy = lodash.find(
        lodash.find(esData, { id: projectId })[option.refPath],
        { id },
      );
      console.log(`one mismatch found for ${option.modelName} with id ${id}`);
      return {
        type: 'mismatch',
        kind: item.type,
        dataType: item.dataType,
        projectId,
        modelName: option.modelName,
        id,
        path,
        dbCopy,
        esCopy,
      };
    }
  };

  if (delta.path.length > 2 && associations[delta.path[1]]) {
    return processAssociation(delta, { modelName: associations[delta.path[1]], refPath: delta.path[1] });
  }
  if (delta.dataType === 'array' && delta.path.length === 1) {
    return processMissingObject(delta, { modelName: 'Project' });
  }
  if (['add', 'delete', 'modify'].includes(delta.type)) {
    const path = scriptUtil.generateJSONPath(lodash.slice(delta.path, 1));
    const id = lodash.get(finalData, lodash.slice(delta.path, 0, 1)).id;
    const dbCopy = lodash.find(dbData, { id });
    const esCopy = lodash.find(esData, { id });
    console.log(`one mismatch found for Project with id ${id}`);
    return {
      type: 'mismatch',
      kind: delta.type,
      dataType: delta.dataType,
      projectId: id,
      modelName: 'Project',
      id,
      path,
      dbCopy,
      esCopy,
    };
  }
}

/**
 * Compare Project data from ES and DB.
 *
 * @param {Object} esData the data from ES
 * @param {Object} dbData the data from DB
 * @returns {Object} the data to feed handlebars template
 */
function compareProjects(esData, dbData) {
  const data = {
    project: {
      rootMismatch: {},
      esOnly: [],
      dbOnly: [],
    },
    meta: {
      esCopies: [],
      dbCopies: [],
      counts: {
        Project: 0,
      },
      uniqueDeltas: [],
    },
  };

  const storeDelta = (root, delta) => {
    if (delta.modelName === 'Project') {
      if (delta.type === 'esOnly') {
        data[root].esOnly.push(delta);
        return;
      }
      if (delta.type === 'dbOnly') {
        data[root].dbOnly.push(delta);
        return;
      }
    }
    if (!data[root].rootMismatch[delta.projectId]) {
      data[root].rootMismatch[delta.projectId] = { project: [], associations: {} };
    }
    if (delta.modelName === 'Project') {
      data[root].rootMismatch[delta.projectId].project.push(delta);
      return;
    }
    const currentAssociations = data[root].rootMismatch[delta.projectId].associations;
    if (!Object.keys(currentAssociations).includes(delta.modelName)) {
      currentAssociations[delta.modelName] = {
        mismatches: {},
        esOnly: [],
        dbOnly: [],
      };
    }
    if (delta.type === 'mismatch') {
      const mismatches = currentAssociations[delta.modelName].mismatches;
      if (!mismatches[delta.id]) {
        mismatches[delta.id] = [];
      }
      mismatches[delta.id].push(delta);
      return;
    }
    currentAssociations[delta.modelName][delta.type].push(delta);
  };

  const collectDataCopies = (delta) => {
    if (delta.dbCopy) {
      if (!lodash.find(data.meta.dbCopies, lodash.pick(delta, ['modelName', 'id']))) {
        data.meta.dbCopies.push(delta);
      }
    }
    if (delta.esCopy) {
      if (!lodash.find(data.meta.esCopies, lodash.pick(delta, ['modelName', 'id']))) {
        data.meta.esCopies.push(delta);
      }
    }
  };

  const countInconsistencies = () => {
    lodash.set(
      data.project,
      'meta.totalObjects',
      data.project.dbOnly.length + data.project.esOnly.length,
    );
    lodash.set(
      data.project,
      'meta.totalProjects',
      Object.keys(data.project.rootMismatch).length + data.project.dbOnly.length + data.project.esOnly.length,
    );
    lodash.map(data.project.rootMismatch, (value) => {
      const currentValue = value;
      lodash.set(currentValue, 'meta.counts', currentValue.project.length ? 1 : 0);
      lodash.map(currentValue.associations, (subObject) => {
        lodash.set(
          subObject,
          'meta.counts',
          Object.keys(subObject.mismatches).length + subObject.dbOnly.length + subObject.esOnly.length,
        );
        currentValue.meta.counts += subObject.meta.counts;
      });
      data.project.meta.totalObjects += currentValue.meta.counts;
    });
  };

  const result = differ.diff(dbData, esData);
  const finalData = differ.patch(Diff.clone(dbData), result);
  const flattenedResult = preProcessDeltas(result);
  for (const item of flattenedResult) {
    if (scriptUtil.isIgnoredPath('project', item.path)) {
      continue; // eslint-disable-line no-continue
    }
    const delta = processDelta(item, esData, dbData, finalData);
    if (delta) {
      collectDataCopies(delta);
      storeDelta('project', delta);
    }
  }
  countInconsistencies();
  return data;
}

module.exports = {
  compareProjects,
};