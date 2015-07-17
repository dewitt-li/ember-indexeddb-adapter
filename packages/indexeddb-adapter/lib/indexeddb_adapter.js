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
    this._super();
    var db = new Dexie(this.get("databaseName"));
    db.version(this.get("databaseVersion")).stores(this.get("databaseTables"));
    db.open().catch(function(error){
      console.log("Error when openning IndexDB:"+error);
    });
    this.set("db",db);
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
    var allowRecursive = this.allowRecursive(opts,true);
    return this.get("db")[type.modelName.camelize()].get(id)
    .then(function(record){
      return adapter.loadIds(store,type,record);
    }).then(function(record){
      if (allowRecursive) {
        return adapter.loadRelationships(type, record, opts&&opts.adapterOptions);
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
    var allowRecursive = this.allowRecursive(opts,true);
    return this.get("db")[type.modelName.camelize()].where("id").anyOf(ids).toArray()
    .then(function(records){
      return adapter.loadIdsForMany(store,type,records);
    }).then(function(records){
      if (allowRecursive) {
        return adapter.loadRelationshipsForMany(type, records, opts&&opts.adapterOptions);
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
    return this.get("db")[type.modelName.camelize()].filter(function(value){
      for (var field in query) {
        if(query[field]!==value[field]){
          return false;
        }
      }
      return true;
    }).toArray()
    .then(function(records){
      return adapter.loadIdsForMany(store,type,records);
    })
    .then(function(records){
      return adapter.loadRelationshipsForMany(store, type, records);
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
  findAll: function (store, type,sinceToken,opts) {
    var adapter = this;
    return this.get("db")[type.modelName.camelize()].toArray()
    .then(function(records){
      return adapter.loadIdsForMany(store,type,records);
    }).then(function(records){
      return adapter.loadRelationshipsForMany(store, type, records, opts&&opts.adapterOptions);
    });
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
    var table=this.get("db")[type.modelName.camelize()];
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
    var table=this.get("db")[type.modelName.camelize()];
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
    return this.get("db")[type.modelName.camelize()].delete(snapshot.id).then(function(){
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
  previousGeneratedId:1,
  generateIdForRecord: function() {
    var date = Date.now();
    if (date <= this.previousGeneratedId) {
        date = ++this.previousGeneratedId;
    } else {
        this.previousGeneratedId = date;
    }
    return date;
  },
  loadIdsForMany: function(store, type, records){
    var relationshipNames = Ember.get(type, 'relationshipNames').hasMany;
    var adapter = this,
        recordsWithHasManyIds = [],
        promises = [],
        promise;
    records.forEach(function(record){
      promise = adapter.loadIds(store,type, record)
          .then(function(recordWithHasManyIds) {
            recordsWithHasManyIds.push(recordWithHasManyIds);
            return Ember.RSVP.resolve();
          });
      promises.push(promise);
    });    
    
    return Ember.RSVP.all(promises).then(function() {
        return Ember.RSVP.resolve(recordsWithHasManyIds);
    });
  },
  loadIds: function(store, type, record){
    var adapter=this;
    var relationshipNames = Ember.get(type, 'relationshipNames').hasMany;
    var relationshipsPromises=[];
    var tableName,columnName,promise;
    relationshipNames.forEach(function(relationshipName){
      tableName=adapter.relationshipProperties(type, relationshipName).type.modelName.camelize();
      columnName=type.modelName.camelize();
      promise= adapter.get("db")[tableName].where(columnName).equals(record.id).keys().then(function(ids){
        record[relationshipName]=ids;
        return Ember.RSVP.resolve(record);
        });
      relationshipsPromises.push(promise);
    });

    return Ember.RSVP.all(relationshipsPromises).then(function() {
      return Ember.RSVP.resolve(record);
    });
  },
  loadRelationshipsForMany: function(store, type, records, options) {
    var adapter = this,
        recordsWithRelationships = [],
        promises = [],
        promise;
    records.forEach(function(record){
      promise = adapter.loadRelationships(store,type, record, options)
          .then(function(recordWithRelationships) {
            recordsWithRelationships.push(recordWithRelationships);
            return Ember.RSVP.resolve();
          });
      promises.push(promise);
    });    
    
    return Ember.RSVP.all(promises).then(function() {
        return Ember.RSVP.resolve(recordsWithRelationships);
    });
  },

  loadRelationships: function(store, type, record,options) {
    var relationships=this.getRelationships(type,options);
    var adapter = this;
    var resultJSON = {},
        relationshipPromises = [];
    relationships.forEach(function(relationName) {
      var relationModel = type.typeForRelationship(relationName,store),
          relationEmbeddedId = record[relationName],
          relationProp  = adapter.relationshipProperties(type, relationName),
          relationType  = relationProp.kind,
          promise=null, embedPromise;
      var opts = {allowRecursive: false};

      if(relationType == 'hasMany' && relationEmbeddedId.length>0){
          promise = adapter.findMany(store, relationModel, relationEmbeddedId, opts);
      }else if (relationType === 'belongsTo' || relationType === 'hasOne') {
          promise = adapter.findRecord(store, relationModel, relationEmbeddedId, opts);
      } 

      if(promise){
        embedPromise=promise.then(function(relationRecord) {
          return Ember.RSVP.resolve(adapter.addEmbeddedPayload(record, relationName, relationRecord));
          });
        relationshipPromises.push(embedPromise);
      }
    });
    return Ember.RSVP.all(relationshipPromises).then(function() {
        return Ember.RSVP.resolve(record);
      });
  },

  addEmbeddedPayload: function(payload, relationshipName, relationshipRecord) {
    if ((relationshipRecord && relationshipRecord.id)
      ||(relationshipRecord && relationshipRecord.length && relationshipRecord.isEvery("id"))) {
        payload['_embedded'] = payload['_embedded']||{};
        payload['_embedded'][relationshipName] = relationshipRecord;
    }
    return payload;
  },


  relationshipProperties: function(type, relationName) {
    var relationships = Ember.get(type, 'relationshipsByName');
    if (relationName) {
      return relationships.get(relationName);
    } else {
      return relationships;
    }
  },

  willDestroy:function(){
    this.get("db").close();
  },
  allowRecursive:function(opts,isRecursive){
    if (opts && typeof opts.allowRecursive !== 'undefined') {
      return opts.allowRecursive||false;
    }else{
      return isRecursive||false;
    }
  },
  getRelationships:function(type,opts){
    var preloadFields=opts && opts.preload && Ember.isArray(opts.preload) && opts.preload ||[];
    var relationshipNames=Ember.get(type,"relationshipNames");
    relationshipNames=relationshipNames.belongsTo.concat(relationshipNames.hasMany);
    var relationshipsByName=Ember.get(type,"relationshipsByName");
    return relationshipNames.filter(function(relationshipName){
      return relationshipsByName.get(relationshipName).options && !relationshipsByName.get(relationshipName).options.async
        ||preloadFields.indexOf(relationshipName);
    });
  }
});
