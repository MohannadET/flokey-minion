const config                = require('./config/index.config.js');
const Cortex                = require('ion-cortex');
const fs                    = require('fs'); 
const os                    = require("os");
const path                  = require("path");
const dotenv                = require('dotenv');
const dotenvParseVariables  = require('dotenv-parse-variables');
const util                  = require('node:util');
const exec                  = util.promisify(require('node:child_process').exec);
const hostname              = os.hostname();

let nodeType = config.dotEnv.MINION_TYPE
let nodeName = config.dotEnv.MASTER_NAME + '_minion'
let nodeEnv  = config.dotEnv.MINION_ENV

let env = dotenv.config({ path:nodeEnv })
if (env.error) throw env.error;

/** entry point for oyster modules */
class Environ {
    constructor({config, Cortex}){
        
        /** init cortex */
        this.exposed    = ['get','getKey', 'set', 'delete', 'write', 'add', 'execute']
        this.env        = dotenvParseVariables(env.parsed);
        this.envPath    = path.resolve(nodeEnv);
        
        this.cortex     = new Cortex({
            prefix: config.dotEnv.CORTEX_PREFIX,
            url: config.dotEnv.CORTEX_REDIS,
            type: nodeName,
            state: ()=>{
                return {} 
            },
            activeDelay: "1000ms",
            idlDelay: "3000ms",
        });
        this.cortex.sub('env.*', (d, meta, cb)=>{
            this.interceptor({data:d, meta, cb});
        })

    }

    _responseHandler({msg,error}){
        if(msg)     return {hostname,msg}
        if(error)   return {hostname,error}
    }
    async interceptor({data, cb, meta}){
        let fnName = meta.event.split('.')[1];
        if(this.exposed.includes(fnName)){
            let result = await this[fnName](data);
            cb(result);
        } else {
            cb({error: `${fnName} is not executable `})
        }
    }

    async execute({cmd}){
        try {
            const { stdout, stderr } = await exec(cmd);
            if(stderr) return this._responseHandler({error:stderr})
            return this._responseHandler({msg:stdout})
        } catch (error) {
            return this._responseHandler({error:error.stderr})
        }

    }
      

    _envExists(){
        let exists = false
        exists = fs.existsSync(this.envPath)
        return exists
    }

    _readEnv(){
        fs.readFileSync(this.envPath, "utf-8").split(os.EOL);
    }

    async get(){
        let obj = {}
        if(this._envExists()){
            obj[nodeName] = {}
            obj[nodeName]['env'] = this.env
            obj[nodeName]['type'] = nodeType

            return obj
        }
        return {error:"Error .env doesn't exists", exists:this._envExists()}
    }

    async add({key, value}){
        console.log(this.env[key])
        if(this.env[key]) return this._responseHandler({error:`Key: ${key} already exists in .env`})
        if(this._envExists()){
            fs.appendFile(this.envPath, `\n`, (err) => {
                if(err) throw err;
                console.log('Saved!');
                fs.appendFile(this.envPath, `${key}=${value}`, function (err) {
                    if(err) throw err;
                });
            });
            
            return this._responseHandler({msg:`Successfully added key: ${key}=${value}`})
        } else {
            return this._responseHandler({error:"Error .env doesn't exists"})
        }
    }


    /**
     * Updates value for existing key or creates a new key=value line
     *
     * This function is a modified version of https://stackoverflow.com/a/65001580/3153583
     *
     * @param {string} key Key to update/insert
     * @param {string} value Value to update/insert
     */
    async set({key, value}){
        if(this._envExists()){
            // read file from hdd & split if from a linebreak to a array
            const ENV_VARS = fs.readFileSync(this.envPath, "utf8").split(os.EOL);

            // find the env we want based on the key
            const target = ENV_VARS.indexOf(ENV_VARS.find((line) => {
                // (?<!#\s*)   Negative lookbehind to avoid matching comments (lines that starts with #).
                //             There is a double slash in the RegExp constructor to escape it.
                // (?==)       Positive lookahead to check if there is an equal sign right after the key.
                //             This is to prevent matching keys prefixed with the key of the env var to update.
                const keyValRegex = new RegExp(`(?<!#\\s*)${key}(?==)`);

                return line.match(keyValRegex);
            }));
            // if key-value pair exists in the .env file,
            if (target !== -1) {
                // replace the key/value with the new value
                ENV_VARS.splice(target, 1, `${key}=${value}`);
            } else {
                // if it doesn't exist, add it instead
                ENV_VARS.push(`${key}=${value}`);
            }

            // write everything back to the file system
            fs.writeFileSync(this.envPath, ENV_VARS.join(os.EOL));
            return this._responseHandler({msg:`Successfully updated key: ${key}, with value: ${value}`})

        } else {
            return this._responseHandler({error:"Error .env doesn't exists"})
        }
    }

    async delete({key}){
        console.log(this.env[key])
        if(!this.env[key]) return {error:`Key: ${key} doesn't exist in .env`}
        if(this._envExists()){
            fs.readFile(this.envPath, {encoding: 'utf-8'}, (err, data) =>{
                if (err) throw error;
            
                let dataArray = data.split('\n'); // convert file data in an array
                const searchKeyword = key; // we are looking for a line, contains, key word in the file
                let lastIndex = -1; // let say, we have not found the keyword
            
                for (let index=0; index<dataArray.length; index++) {
                    if (dataArray[index].includes(searchKeyword)) { // check if a line contains the keyword
                        lastIndex = index; // found a line includes a keyword
                        break; 
                    }
                }
            
                dataArray.splice(lastIndex, 1); // remove the keyword from the data Array
            
                // UPDATE FILE WITH NEW DATA
                // IN CASE YOU WANT TO UPDATE THE CONTENT IN YOUR FILE
                // THIS WILL REMOVE THE LINE CONTAINS keyword IN YOUR .env FILE
                const updatedData = dataArray.join('\n');
                fs.writeFile(this.envPath, updatedData, (err) => {
                    if (err) throw err;
                    console.log (`Successfully delete ${searchKeyword} the env file`);
                });
            
            });
            return this._responseHandler({msg:`Successfully delete key: ${key}`})
        } else {
            return this._responseHandler({error:"Error .env doesn't exists"})
        }
    }

    async write({data}){
        try {
            fs.writeFileSync(this.envPath, data);
            return {msg: "Successfully updated .env file!"}
        // file written successfully
        } catch (err) {
            console.error(err);
            return {error:err}
        }
    }

}

const environ = new Environ({config, Cortex})