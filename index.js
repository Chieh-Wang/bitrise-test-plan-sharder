// Inputs
const SOURCE_DIR = process.env.source_dir + '/';
const XCODE_PROJECT = process.env.xcode_project;//'Notes.xcodeproj';
const SHARDS = process.env.shards;//2
const TARGET = process.env.target;//'NotesUITests';
const TYPE = process.env.file_type;//'.swift';

console.log('SOURCE_DIR:',SOURCE_DIR)
console.log('XCODE_PROJECT:',XCODE_PROJECT)
console.log('TARGET:',TARGET)
console.log('SHARDS:',SHARDS)
console.log('TYPE:',TYPE)

// Outputs
const TEST_PLANS = [];

const xcode = require('xcode'),
    fs = require('fs'),
    uuid = require('uuid'),
    projectPath = SOURCE_DIR + XCODE_PROJECT + '/project.pbxproj',
    outputProjectPath = SOURCE_DIR + XCODE_PROJECT + '/project.pbxproj',
    myProj = xcode.project(projectPath);


// parsing is async, in a different process
myProj.parse(function (err) {
    if (err) {
        console.error('Error:', err);
        return;
    }
    const project = myProj.getFirstProject();
    const main_group_uuid = project.firstProject.mainGroup;
    const group = myProj.getPBXGroupByKey(main_group_uuid);
    const target = group.children.find((child) => child.comment == TARGET);
    const target_uuid = target.value;

    const tests = myProj.getPBXGroupByKey(target_uuid).children.filter((test) => test.comment.indexOf(TYPE) != -1);
    const shard_size = Math.ceil(tests.length / SHARDS);
    const shards = shard(tests, shard_size);

    shards.forEach((shard, index) => {
        let shardName = 'NotesUITests/TestShard_'+index+'.xctestplan';
        TEST_PLANS.push(shardName);

        myProj.addResourceFile(shardName, {lastKnownFileType: 'text'}, main_group_uuid);
        fs.writeFileSync(SOURCE_DIR+shardName, createTestPlan(target_uuid, [].concat(shards), index));
    })
    fs.writeFileSync(outputProjectPath, myProj.writeSync());
    let quotedAndCommaSeparated = "\"" + SOURCE_DIR + TEST_PLANS.join("\",\""+SOURCE_DIR) + "\"";
    console.log(SHARDS+' Test Plans Created:', quotedAndCommaSeparated);
    process.env.test_plans = quotedAndCommaSeparated;
});

function createTestPlan(target_uuid, shards, shardIndex){
    let skipTests = shards.filter((shard, index) => index != shardIndex);
    let skipTestNames = [];
    skipTests.forEach((skipTest) => {
        let tests = skipTest.map((test) => test.comment.substring(0, test.comment.indexOf('.')));
        skipTestNames = skipTestNames.concat(tests);
    });
    let testPlan = {
        "configurations" : [
            {
                "id" : (''+uuid.v4()).toUpperCase(),
                "name" : "Configuration 1",
                "options" : {
            
                }
            }
        ],
        "defaultOptions" : {
            "codeCoverage" : false
        },
        "testTargets" : [
          {
            "skippedTests" : skipTestNames,
            "target" : {
              "containerPath" : "container:"+XCODE_PROJECT,
              "identifier" : target_uuid,
              "name" : TARGET
            }
          }
        ],
        "version" : 1
      }
    return JSON.stringify(testPlan);
}

function shard(arr, howMany) {
    var newArr = []; start = 0; end = howMany;
    for(var i=1; i<= Math.ceil(arr.length / howMany); i++) {
        newArr.push(arr.slice(start, end));
        start = start + howMany;
        end = end + howMany
    }
    return newArr;
}
