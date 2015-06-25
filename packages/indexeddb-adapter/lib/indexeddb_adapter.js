/*global Ember*/
/*global DS*/
'use strict';

DS.IndexedDBAdapter = DS.Adapter.extend({
  databaseName: 'IDBAdapter',
  databaseVersion:1,
  databaseTables:{},
  db:null,
  /**
   * IndexedDB requires that the database is initialized and have a defined
   * schema. It's not like localStorage, where you just store things. You have
   * to define beforehand what Object Stores you want (e.g User, Post etc).
   *
   * @method init
   */
  init: function() {
    var db = new Dexie(this.get("databaseName"));
    db.version(this.get("databaseVersion")).stores(this.get("databaseTables"));
    db.open().catch(function(error){
      console.log("Error when openning IndexDB:"+error);
    });
  },

  
  /**
   * This methods is used by the store to retrieve one record by ID.
   *
   * @method serialize
   * @param {DS.Store} store
   * @param {DS.Model} type
   * @param {Object|String|Integer|null} id
   * @param {Object|null} opts
   */
  findRecord: function (store, type, id, opts) {
    var adapter = this;
    var allowRecursive = true;

    if (opts && typeof opts.allowRecursive !== 'undefined') {
      allowRecursive = opts.allowRecursive;
    }

    return this.get("db")[type.modelName].get(id).then(function(record){
      if (allowRecursive) {
        return adapter.loadRelationships(type, record).then(function(finalRecord) {
          Em.run(function() {
            adapter.cleanLostRelationshipsReferences(store, type, finalRecord);
            return Ember.RSVP.resolve(finalRecord);
          });
        });
      } else {
          return Ember.RSVP.resolve(record);
      }
    });
  },

  /**
   * Retrieves many records from the database.
   *
   * @method findMany
   * @private
   * @param {DS.Store} store
   * @param {DS.Model} type the model that we're retrieving
   * @param {Array} ids ids of the records we want to be returned.
   */
  findMany: function (store, type, ids, opts) {
    var adapter = this;
    var allowRecursive = true;

    if (opts && typeof opts.allowRecursive !== 'undefined') {
      allowRecursive = opts.allowRecursive;
    }

    return this.get("db")[type.modelName].where("id").anyOf(ids).toArray().then(function(records){
      if (allowRecursive) {
        return adapter.loadRelationshipsForMany(type, records);
      } else {
          return Ember.RSVP.resolve(records);
      }
    });
  },

  /**
   * Retrieves many records from the database according to the query.
   *
   * For example, we could do:
   *
   *     store.findQuery('customer', {name: /rambo|braddock/})
   *
   * @method findQuery
   * @private
   * @param {DS.Store} store
   * @param {DS.Model} type the model
   * @param {Object} query object with fields we want to look for
   */
  query: function (store, type, query) {
    var adapter = this;
    return this.get("db")[type.modelName].filter(function(value){
      for (var field in query) {
        if(query[field]!==value[field]){
          return false;
        }
      }
      return true;
    }).toArray().then(function(records){
      return this.loadRelationshipsForMany(store, type, records);
    });
  },


  /**
   * Returns all records of a given type.
   *
   * @method findAll
   * @private
   * @param {DS.Store} store
   * @param {DS.Model} type
   */
  findAll: function (store, type) {
    return this.get("db")[type.modelName].toArray();
  },

  /**
   * Creates a record in the database.
   *
   * For example,
   *
   * ```js
   * store.createRecord('user', {name: "Rambo"})
   * ```
   *
   * @method createRecord
   * @param {DS.Store} store
   * @param {DS.Model} type
   * @param {Object} record
   */
  createRecord: function (store, type, snapshot) {
    var adapter=this;
    var table=this.get("db")[type.modelName];
    var serialized = this.serialize(snapshot,{includeId:!table.schema.primKey.auto});
    return table.add(serialized).then(function(){
      return adapter.loadRelationships(store,type,serialized);
    });
  },

  /**
   *
   * @method updateRecord
   * @param {DS.Store} store
   * @param {DS.Model} type
   * @param {Object} snapshot
   */
  updateRecord: function (store, type, snapshot) {
    var adapter=this;
    var table=this.get("db")[type.modelName];
    var serialized = this.serialize(snapshot,{includeId:!table.schema.primKey.auto});
    return table.put(serialized).then(function(){
      return Ember.RSVP.resolve(serialized);
    });
  },

  /**
   *
   * @method deleteRecord
   * @param {DS.Store} store
   * @param {DS.Model} type
   * @param {Object} snapshot
   */
  deleteRecord: function (store, type, snapshot) {
    return this.get("db")[type.modelName].delete(snapshot.id).then(function(){
      return Ember.RSVP.resolve(serialized);
    });
  },

  /**
   * Generates a random number. You will usually want to implement UUID in your
   * app and redefine this method.
   *
   * @method generateIdForRecord
   * @private
   */
  previousGeneratedId:1;
  generateIdForRecord: function() {
    var date = Date.now();
    if (date <= this.previousGeneratedId) {
        date = ++this.previousGeneratedId;
    } else {
        this.previousGeneratedId = date;
    }
    return date;
  },

  /**
   * This takes a record, then analyzes the model relationships and replaces
   * ids with the actual values.
   *
   * Consider the following JSON is entered:
   *
   * ```js
   * {
   *   "id": 1,
   *   "title": "Rails Rambo",
   *   "comments": [1, 2]
   * }
   *
   * This will return:
   *
   * ```js
   * {
   *   "id": 1,
   *   "title": "Rails Rambo",
   *   "comments": [1, 2]
   *
   *   "_embedded": {
   *     "comment": [{
   *       "_id": 1,
   *       "comment_title": "FIRST"
   *     }, {
   *       "_id": 2,
   *       "comment_title": "Rails is unagi"
   *     }]
   *   }
   * }
   *
   * This way, whenever a resource returned, its relationships will be also
   * returned.
   *
   * @method loadRelationships
   * @private
   * @param {DS.Model} type
   * @param {Object} record
   */
  loadRelationships: function(store, type, record) {
    var adapter = this;
    var resultJSON = {},
        modelName = type.modelName,
        relationships,
        relationshipPromises = [];
        relationshipNames = Ember.get(type, 'relationshipNames'),
        relationships = relationshipNames.belongsTo.concat(relationshipNames.hasMany),
        recordPromise = Ember.RSVP.resolve(record);

    relationships.forEach(function(relationName) {
      var relationModel = type.typeForRelationship(relationName),
          relationEmbeddedId = record[relationName],
          relationProp  = adapter.relationshipProperties(type, relationName),
          relationType  = relationProp.kind,
          foreignAdapter = store.adapterFor(relationName),
          promise, embedPromise;

      var opts = {allowRecursive: false};
      /**
       * embeddedIds are ids of relations that are included in the main
       * payload, such as:
       *
       * {
       *    cart: {
       *      id: "s85fb",
       *      customer: "rld9u"
       *    }
       * }
       *
       * In this case, cart belongsTo customer and its id is present in the
       * main payload. We find each of these records and add them to _embedded.
       */
      if (relationEmbeddedId && foreignAdapter === adapter) {
        recordPromise = recordPromise.then(function(recordPayload) {
          var promise;
          if (relationType === 'belongsTo' || relationType === 'hasOne') {
            promise = adapter.find(store, relationModel, relationEmbeddedId, opts);
          } else if (relationType == 'hasMany') {
            promise = adapter.findMany(store, relationModel, relationEmbeddedId, opts);
          }

          return promise.then(function(relationRecord) {
            return adapter.addEmbeddedPayload(recordPayload, relationName, relationRecord);
          });
        });
    return recordPromise;
  },

  /**
   * Given the following payload,
   *
   *   {
   *      cart: {
   *        id: "1",
   *        customer: "2"
   *      }
   *   }
   *
   * With `relationshipName` being `customer` and `relationshipRecord`
   *
   *   {id: "2", name: "Rambo"}
   *
   * This method returns the following payload:
   *
   *   {
   *      cart: {
   *        id: "1",
   *        customer: "2"
   *      },
   *      _embedded: {
   *        customer: {
   *          id: "2",
   *          name: "Rambo"
   *        }
   *      }
   *   }
   *
   * which is then treated by the serializer later.
   *
   * @method addEmbeddedPayload
   * @private
   * @param {Object} payload
   * @param {String} relationshipName
   * @param {Object} relationshipRecord
   */
  addEmbeddedPayload: function(payload, relationshipName, relationshipRecord) {
    var objectHasId = (relationshipRecord && relationshipRecord.id),
        arrayHasIds = (relationshipRecord.length && relationshipRecord.isEvery("id")),
        isValidRelationship = (objectHasId || arrayHasIds);

    if (isValidRelationship) {
      if (!payload['_embedded']) {
        payload['_embedded'] = {}
      }

      payload['_embedded'][relationshipName] = relationshipRecord;
      if (relationshipRecord.length) {
        payload[relationshipName] = relationshipRecord.mapBy('id');
      } else {
        payload[relationshipName] = relationshipRecord.id;
      }
    }

    if (Ember.isArray(payload[relationshipName])) {
      payload[relationshipName] = payload[relationshipName].filterBy("id");
    }

    return payload;
  },
  /**
   * Same as `loadRelationships`, but for an array of records.
   *
   * @method loadRelationshipsForMany
   * @private
   * @param {DS.Model} type
   * @param {Object} recordsArray
   */
  loadRelationshipsForMany: function(store, type, recordsArray) {
    var adapter = this,
        promise = Ember.RSVP.resolve([]);

    recordsArray.forEach(function(record) {
      promise = promise.then(function(records) {
        return adapter.loadRelationships(store, type, record)
          .then(function(loadedRecord) {
            records.push(loadedRecord);
            return records;
          });
      });
    });

    return promise;
  },

  /**
   *
   * @method relationshipProperties
   * @private
   * @param {DS.Model} type
   * @param {String} relationName
   */
  relationshipProperties: function(type, relationName) {
    var relationships = Ember.get(type, 'relationshipsByName');
    if (relationName) {
      return relationships.get(relationName);
    } else {
      return relationships;
    }
  },

  /**
   * Some times, a payload has a reference for an association, like `comments`
   * below, but the actual record doesn't exist anymore.
   *
   *   payload = {
   *     id: "1",
   *     comments: ["2"],
   *     _embedded: {
   *     }
   *   };
   *
   * In this case, we should not return the `comments: ["2"]` relationship to
   * the serializer.
   *
   * @method cleanLostRelationshipsReferences
   * @private
   * @param {DS.Model} type
   * @param {Hash} payload
   */
  cleanLostRelationshipsReferences: function(store, type, payload) {
    var adapter = this;

    Ember.get(type, 'relationshipsByName').forEach(function(relationName, properties) {
      var NoEmbeddedRelations = function() {
        return !payload._embedded || !payload._embedded[relationName];
      }

      var IsLostRelationshipReference = function(id) {
        if (store.hasRecordForId(properties.type, id)) {
          return false;
        } else if(NoEmbeddedRelations()) {
          delete payload[relationName];
          return true;
        }
      }

      if (Ember.isArray(payload[relationName])) {
        payload[relationName] = payload[relationName].filter(function(id) {
          return !IsLostRelationshipReference(id);
        });
      } else if (payload[relationName]) {
        if (IsLostRelationshipReference(payload[relationName])) {
          payload[relationName] = null;
        }
      }
    });
  },
  willDestroypublic:function(){
    this.get("db").close();
  }
});
