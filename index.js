// Inputs
const XCODE_PATH = process.env.path_to_xcode + '/';
const XCODE_PROJECT = process.env.xcode_project;
const SHARDS = process.env.shards;
const TEST_PLAN = process.env.test_plan;
const TARGET = process.env.target;
const TEST_PATH = process.env.test_path;
const SCHEME = process.env.scheme;
const DEBUG = process.env.debug_mode == 'true' ? true : false;

console.log('XCODE_PATH:', XCODE_PATH)
console.log('XCODE_PROJECT:', XCODE_PROJECT)
console.log('TEST_PLAN:', TEST_PLAN)
console.log('TARGET:', TARGET)
console.log('TEST_PATH:', TEST_PATH)
console.log('SCHEME:', SCHEME)
console.log('SHARDS:', SHARDS)
console.log('DEBUG:', DEBUG)

// Outputs
const TEST_PLANS = [];

const xcode = require('xcode'),
    fs = require('fs'),
    uuid = require('uuid'),
    parser = require('xml2json'),
    projectPath = XCODE_PATH + XCODE_PROJECT + '/project.pbxproj',
    outputProjectPath = XCODE_PATH + XCODE_PROJECT + '/project.pbxproj',
    myProj = xcode.project(projectPath);

myProj.parse(function (err) {
    if (err) {
        console.error('Error:', err);
        return;
    }
    const project = myProj.getFirstProject();
    const main_group_uuid = project.firstProject.mainGroup;
    const group = myProj.getPBXGroupByKey(main_group_uuid);
    log('Target children: ', group.children)
    const target = group.children.find((child) => child.comment == TARGET);
    const target_uuid = target.value;

    const tests = getRecursiveTests(myProj, target_uuid, []);
    log('UITests files found in Target:', tests.length);

    const shard_size = Math.round(tests.length / SHARDS);
    log('Expected number of UITests files for each shard:', shard_size);

    const shards = shard(tests, shard_size);
    log('UITests files for each shard: ', shards)

    let classNameShards = [];
    var totalNumberOfTests = 0;
    
    if (TEST_PATH != '') {
        let files = walkSync(TEST_PATH, []);
        shards.forEach((shard, shardIndex) => {
            classNameShards.push([]);
            shard.forEach((test, i) => {
                let path = files.find((file) => file.indexOf(test.comment) != -1);
                try {
                    var classInfo = {};
                    let testFile = fs.readFileSync(path, 'utf-8');
                    testFile.split(/\r?\n/).forEach((line) => {
                        if (line.includes(': BaseUITestCase {')) {
                            let searchStr = 'class';
                            let classIdx = line.indexOf(searchStr)
                            let endIdx = line.indexOf(':')
                            let className = line.substring(classIdx + searchStr.length + 1, endIdx);
                            classInfo["className"] = className;
                            classInfo["numberOfTests"] = 0;
                        }

                        if (line.includes('func test')) {
                            classInfo["numberOfTests"] = classInfo["numberOfTests"] + 1;
                            totalNumberOfTests += 1;
                        }
                    });

                    classNameShards[shardIndex].push(classInfo);
                } catch (err) {
                    log('Error parsing file: ' + path, err);
                }
            });
        });
    } else {
        shards.forEach((shard) => {
            let classNames = shard.map((test) => test.comment.substring(0, test.comment.indexOf('.')));
            classNameShards.push(classNames);
        })
    }

    // Specify number of tests for test plans
    log('Total number of tests: ', totalNumberOfTests);
    const fixedNumberOfTestsForFirstPlan = Math.round(totalNumberOfTests / 5);
    const numberOfTestsForOtherPlans = Math.round((totalNumberOfTests - fixedNumberOfTestsForFirstPlan) / (SHARDS - 1));
    var excess = [];

    // Remove excess part if shardTarget > acceptableMaximumTests
    classNameShards.forEach((shardTarget, index) => { 
        const numberOfTests = (index == 0 ? fixedNumberOfTestsForFirstPlan : numberOfTestsForOtherPlans);
        const acceptableMinimumTests = numberOfTests - 3;
        const acceptableMaximumTests = numberOfTests + 3;
        log("acceptableMinumumTests for index " + index + " : "  ,acceptableMinimumTests);
        log("acceptableMaximumTests for index " + index + " : "  ,acceptableMaximumTests);
        
        shardTarget.sort((a, b) => a.numberOfTests - b.numberOfTests);
        var nothingToRemove = false;
        while (((shardTarget.reduce(function (acc, obj) { return acc + obj.numberOfTests; }, 0)) > acceptableMaximumTests) && nothingToRemove == false) {
            const numberOfTests = shardTarget.reduce(function (acc, obj) { return acc + obj.numberOfTests; }, 0);
            if ((numberOfTests - shardTarget[0].numberOfTests) >= acceptableMinimumTests) {
                excess.push(shardTarget.shift());
            } else {
                nothingToRemove = true;
            }
        }
    })

    log('excess: ', excess);

    // Add excess part if shardTarget < acceptableMinimumTests
    classNameShards.forEach((shardTarget, index) => { 
        const numberOfTests = (index == 0 ? fixedNumberOfTestsForFirstPlan : numberOfTestsForOtherPlans);
        const acceptableMinimumTests = numberOfTests - 3;
        const acceptableMaximumTests = numberOfTests + 3;
        
        excess.sort((a, b) => a.numberOfTests - b.numberOfTests);
        var nothingToAdd = false;
        while (((shardTarget.reduce(function (acc, obj) { return acc + obj.numberOfTests; }, 0)) < acceptableMinimumTests) && excess.length > 0 && nothingToAdd == false) {
            const numberOfTests = shardTarget.reduce(function (acc, obj) { return acc + obj.numberOfTests; }, 0);
            if ((numberOfTests + excess[0].numberOfTests) <= acceptableMaximumTests) {
                shardTarget.push(excess.shift());
            } else {
                nothingToAdd = true;
            }
        }

        // Add the rest excess part to the final one in case there is any
        if (index == SHARDS - 1) {
            excess.forEach((item, index) => {
                shardTarget.push(excess.shift());
            })
        }
    })

    log('excess: ', excess);
    log('classNameShards: ', classNameShards);

    // Debug info
    if (DEBUG) {
        classNameShards.forEach((shardTarget, index) => {
            const result = shardTarget.reduce(function (acc, obj) { return acc + obj.numberOfTests; }, 0); 
            log('Shard[' + index + '] has ' + shardTarget.length + ' classes');
            log('Shard[' + index + '] has ' + result + ' tests');
            
            let duplicates = [];
            classNameShards.forEach((shardCompare, i) => {
                if (index != i) {
                    shardTarget.forEach((sTarget, i) => {
                        shardCompare.forEach((sCompare, i) => {
                            if (sTarget == sCompare) {
                                duplicates.push(sTarget)
                            }
                        });
                    })
                }
            });
            log('Duplicates in Shard[' + index + ']', duplicates)
        })
    }

    // Clean up the array
    classNameShards.forEach((shardTarget, index) => {
        const classes = shardTarget.map(x => x.className);
        classNameShards[index] = classes;
    })

    log('classNameShards: ', classNameShards);


    if (classNameShards.length == 0) {
        console.error('Error no tests found in Target');
        return;
    }

    if (TEST_PLAN == '') {
        log('\nCreating ' + classNameShards.length + ' Test Plan shards from Scheme');
        addTestPlans(main_group_uuid, classNameShards);
    } else {
        log('\nCreating ' + shards.length + ' Test Plan shards from Test Plan');
        updateTestPlan(classNameShards);
    }

    let quotedAndCommaSeparated = "\"" + XCODE_PATH + TEST_PLANS.join("\",\"" + XCODE_PATH) + "\"";
    // TODO Use Envman to save these globally
    process.env.test_plans = quotedAndCommaSeparated;
});

// List all files in a directory in Node.js recursively in a synchronous fashion
function walkSync(dir, filelist) {
    var path = path || require('path');
    var fs = fs || require('fs'),
        files = fs.readdirSync(dir);
    filelist = filelist || [];
    files.forEach(function (file) {
        if (fs.statSync(path.join(dir, file)).isDirectory()) {
            filelist = walkSync(path.join(dir, file), filelist);
        }
        else {
            filelist.push(path.join(dir, file));
        }
    });
    return filelist;
};

// Update existing test plan
function updateTestPlan(shards) {
    let testPlanPath = XCODE_PATH + TEST_PLAN;
    fs.readFile(testPlanPath, function (err, testPlanData) {
        if (err) {
            console.error('Error reading test plan:', err);
            process.exit();
        }
        let jsonString = testPlanData.toString();
        let testPlanJson = JSON.parse(jsonString.replace(/\\\//g, "~"));
        let otherTargets = testPlanJson.testTargets.filter((target) => target.target.name != TARGET)

        const target_shard_size = Math.ceil(otherTargets.length / SHARDS);
        const otherTargetsShards = shard(otherTargets, target_shard_size);

        log('otherTargetsShards:', otherTargetsShards);

        // Create Test Plans
        shards.forEach((shard, shardIndex) => {
            let shardName = XCODE_PATH + 'TestShard_' + shardIndex + '.xctestplan';
            TEST_PLANS.push(shardName);

            let skipTestsShard = shards.filter((shard, index) => index != shardIndex);
            let skipTestNames = [];
            skipTestsShard.forEach((skipTests) => {
                skipTestNames = skipTestNames.concat(skipTests);
            });

            let mainTarget = getMainTargetFromTestPlan(testPlanJson, skipTestNames);
            log('mainTarget:', mainTarget);

            let shardTargets = otherTargetsShards.length > shardIndex ? otherTargetsShards[shardIndex] : [];
            log('shardTargets:', shardTargets);

            // Disable other targets not in the shard
            let disabledShards = otherTargetsShards.filter((tmp, i) => i != shardIndex);
            let allDisabledShards = [];
            disabledShards.forEach((disabledShard) => {
                disabledShard.forEach((target) => {
                    let disabledTarget = Object.assign({}, target)
                    disabledTarget.enabled = false;
                    allDisabledShards.push(disabledTarget);
                })
            });

            log('Writing Test Plan to file');

            let testPlan = createTestPlan(testPlanJson.defaultOptions, [mainTarget].concat(shardTargets).concat(allDisabledShards));

            fs.writeFileSync(shardName, testPlan);

            console.log('Test Plan Shard ' + shardIndex + ' Created:', shardName);
        })
    });
}

function getMainTargetFromTestPlan(testPlanJson, skippedShardTests) {
    let mainTarget = null;
    testPlanJson.testTargets.forEach((testTarget) => {
        if (testTarget.target.name == TARGET) {
            mainTarget = JSON.parse(JSON.stringify(testTarget));
            mainTarget.skippedTests = mainTarget.skippedTests.concat(skippedShardTests);
        }
    });
    if (mainTarget == null) {
        console.error('Error cannot find Test Target');
        process.exit();
    }
    return mainTarget;
}

// Create and add test plans to project
function addTestPlans(main_group_uuid, shards) {
    let schemePath = XCODE_PATH + XCODE_PROJECT + '/xcshareddata/xcschemes/' + SCHEME + '.xcscheme';
    fs.readFile(schemePath, function (err, schemeData) {
        if (err) {
            console.error('Error reading scheme:', err);
            process.exit();
        }

        // Handle &quot; in xml
        let unescapedData = schemeData.toString().replace(/&quot;/g, '~').replace(/&#10;/g, '^');

        // Parse XML to JSON
        let jsonStr = parser.toJson(unescapedData, { reversible: true })
        let schemeJson = JSON.parse(jsonStr);
        log('Scheme: ', schemeJson);

        // Get the Scheme default options
        let defaultOptions = getDefaulOptions(schemeJson);

        let otherTargets = getOtherTargets(schemeJson);
        const target_shard_size = Math.ceil(otherTargets.length / SHARDS);
        const otherTargetsShards = shard(otherTargets, target_shard_size);

        log('otherTargetsShards:', otherTargetsShards);

        // Create Test Plans
        shards.forEach((shard, shardIndex) => {
            let shardName = 'TestShard_' + shardIndex + '.xctestplan';
            TEST_PLANS.push(shardName);

            log('\nAdding test plan to XCode Project\'s Resources');
            myProj.addResourceFile(shardName, { lastKnownFileType: 'text' }, main_group_uuid);

            let skipTests = shards.filter((shard, index) => index != shardIndex);
            let skipTestNames = [];
            skipTests.forEach((skipTest) => {
                skipTestNames = skipTestNames.concat(skipTest);
            });

            let mainTarget = getMainTarget(schemeJson, skipTestNames);

            log('mainTarget:', mainTarget);

            let shardTargets = otherTargetsShards.length > shardIndex ? otherTargetsShards[shardIndex] : [];

            // Disable other targets not in the shard
            let disabledShards = otherTargetsShards.filter((tmp, i) => i != shardIndex);
            let allDisabledShards = [];
            disabledShards.forEach((disabledShard) => {
                disabledShard.forEach((target) => {
                    let disabledTarget = Object.assign({}, target)
                    disabledTarget.enabled = false;
                    allDisabledShards.push(disabledTarget);
                })
            });

            log('Writing Test Plan to file');
            fs.writeFileSync(XCODE_PATH + shardName, createTestPlan(defaultOptions, [mainTarget].concat(shardTargets).concat(allDisabledShards)));

            console.log('Test Plan Shard ' + shardIndex + ' Created:', shardName);
        })
        log('\nAdding Test Plans to XCode scheme');

        // Add Test Plans to scheme
        let schemeWithTestPlansJson = addTestPlanToXCodeScheme(schemeJson, TEST_PLANS);

        // Handle &quot; in xml
        let reescapedData = JSON.stringify(schemeWithTestPlansJson).replace(/~/g, '&quot;').replace(/\^/g, '&#10;')

        let xml = parser.toXml(reescapedData);
        fs.writeFile(schemePath, xml, function (err, data) {
            if (err) {
                console.error(err);
                process.exit();
            } else {
                console.log('XCode scheme updated');
                fs.writeFileSync(outputProjectPath, myProj.writeSync());
                console.log('XCode project updated');
            }
        });
    });
}

function getOtherTargets(schemeJson) {
    let targets = [];
    if (schemeJson.Scheme && schemeJson.Scheme.TestAction) {
        let testAction = schemeJson.Scheme.TestAction;
        if (testAction.Testables) {
            log('\nScheme Testables: ', testAction);
            let testableReference = [];
            if (testAction.Testables.TestableReference instanceof Array) {
                testableReference = testAction.Testables.TestableReference;
            } else {
                testableReference = [testAction.Testables.TestableReference];
            }
            testableReference.forEach((testableReference) => {
                let buildableReference = testableReference.BuildableReference;
                if (testableReference.skipped == 'NO' && buildableReference.BlueprintName != TARGET) {
                    let skippedTests = null;
                    if (testableReference.SkippedTests) {
                        skippedTests = [];
                        if (testableReference.SkippedTests.Test instanceof Array) {
                            testableReference.SkippedTests.Test.forEach((skippedTest) => {
                                skippedTests.push(skippedTest.Identifier);
                            })
                        } else {
                            skippedTests.push(testableReference.SkippedTests.Test.Identifier);
                        }
                    }
                    let testTarget = {
                        target: {
                            containerPath: buildableReference.ReferencedContainer.replace(/\//g, "~"),
                            identifier: buildableReference.BlueprintIdentifier,
                            name: buildableReference.BlueprintName
                        }
                    };
                    if (skippedTests != null) {
                        testTarget.skippedTests = skippedTests;
                    }
                    targets.push(testTarget);
                }
            })
        }
    }
    return targets;
}

function getMainTarget(schemeJson, skippedShardTests) {
    let target = null;
    if (schemeJson.Scheme && schemeJson.Scheme.TestAction) {
        let testAction = schemeJson.Scheme.TestAction;
        if (testAction.Testables) {
            let testableReference = [];
            if (testAction.Testables.TestableReference instanceof Array) {
                testableReference = testAction.Testables.TestableReference;
            } else {
                testableReference = [testAction.Testables.TestableReference];
            }
            testableReference.forEach((testableReference) => {
                let buildableReference = testableReference.BuildableReference;
                if (testableReference.skipped == 'NO' && buildableReference.BlueprintName == TARGET) {
                    let skippedTests = [];
                    if (testableReference.SkippedTests) {
                        if (testableReference.SkippedTests.Test instanceof Array) {
                            testableReference.SkippedTests.Test.forEach((skippedTest) => {
                                skippedTests.push(skippedTest.Identifier);
                            })
                        } else {
                            skippedTests.push(testableReference.SkippedTests.Test.Identifier);
                        }
                    }
                    let allSkippedTests = skippedTests.concat(skippedShardTests)
                    target = {
                        "skippedTests": allSkippedTests,
                        "target": {
                            "containerPath": buildableReference.ReferencedContainer.replace(/\//g, "~"),
                            "identifier": buildableReference.BlueprintIdentifier,
                            "name": buildableReference.BlueprintName
                        }
                    };
                }
            })
        }
    }
    if (target == null) {
        console.error('Error: unable to find main target:', TARGET);
        process.exit();
    }
    return target;
}

function getDefaulOptions(schemeJson) {
    let environmentVariableEntries = [];
    let commandLineArgumentEntries = [];
    let undefinedBehaviorSanitizerEnabled = null;
    let targetForVariableExpansion = null;
    let codeCoverage = false;
    if (schemeJson.Scheme && schemeJson.Scheme.LaunchAction) {
        let launchAction = schemeJson.Scheme.LaunchAction;
        // CommandLineArguments
        if (launchAction.CommandLineArguments) {
            let cmgArgs = launchAction.CommandLineArguments.CommandLineArgument;
            if (cmgArgs instanceof Array) {
                cmgArgs.forEach((cmdArg) => {
                    commandLineArgumentEntries.push({
                        argument: cmdArg.argument,
                        enabled: cmdArg.isEnabled == 'YES' ? true : false
                    });
                })
            } else { // Single Element
                commandLineArgumentEntries.push({
                    argument: cmgArgs.argument,
                    enabled: cmgArgs.isEnabled == 'YES' ? true : false
                });
            }
        }
        // EnvironmentVariables
        if (launchAction.EnvironmentVariables) {
            let envVars = launchAction.EnvironmentVariables.EnvironmentVariable;
            if (envVars instanceof Array) {
                envVars.forEach((envVar) => {
                    environmentVariableEntries.push({
                        key: envVar.key,
                        value: envVar.value.replace(/\//g, "~"),
                        enabled: envVar.isEnabled == 'YES' ? true : false
                    });
                })
            } else { // Single Element
                environmentVariableEntries.push({
                    key: envVars.key,
                    value: envVars.value.replace(/\//g, "~"),
                    enabled: envVars.isEnabled == 'YES' ? true : false
                });
            }
        }
    }
    if (schemeJson.Scheme && schemeJson.Scheme.TestAction) {
        let testAction = schemeJson.Scheme.TestAction;
        if (testAction.codeCoverageEnabled) {
            codeCoverage = true;
        }
        // targetForVariableExpansion
        if (testAction.MacroExpansion && testAction.MacroExpansion.BuildableReference) {
            let ref = testAction.MacroExpansion.BuildableReference;
            targetForVariableExpansion = {
                containerPath: ref.ReferencedContainer,
                identifier: ref.BlueprintIdentifier,
                name: ref.BlueprintName
            };
        }
        // undefinedBehaviorSanitizerEnabled
        if (testAction.enableUBSanitizer != null) {
            undefinedBehaviorSanitizerEnabled = testAction.enableUBSanitizer == 'YES' ? true : false;
        }

    }
    let defaultOpts = {};
    if (commandLineArgumentEntries.length > 0) {
        defaultOpts.commandLineArgumentEntries = commandLineArgumentEntries;
    }
    if (environmentVariableEntries.length > 0) {
        defaultOpts.environmentVariableEntries = environmentVariableEntries;
    }
    if (targetForVariableExpansion != null) {
        defaultOpts.targetForVariableExpansion = targetForVariableExpansion;
    }
    if (undefinedBehaviorSanitizerEnabled != null) {
        defaultOpts.undefinedBehaviorSanitizerEnabled = undefinedBehaviorSanitizerEnabled;
    }
    if (codeCoverage) {
        defaultOpts.codeCoverage = codeCoverage;
    }
    return defaultOpts;
}

function addTestPlanToXCodeScheme(schemeJson, testPlans) {
    if (schemeJson.Scheme && schemeJson.Scheme.TestAction) {
        schemeJson.Scheme.TestAction.TestPlans = {
            TestPlanReference: []
        };
        testPlans.forEach((testPlan) => {
            schemeJson.Scheme.TestAction.TestPlans.TestPlanReference.push({ reference: 'container:' + testPlan, '$t': '' })
        });
    } else {
        console.error('Error: json.Scheme && json.Scheme.TestAction not found');
        process.exit();
    }
    return schemeJson;
}

function createTestPlan(defaultOptions, testTargets) {
    let testPlan = {
        "configurations": [
            {
                "id": ('' + uuid.v4()).toUpperCase(),
                "name": "Configuration 1",
                "options": {}
            }
        ],
        "defaultOptions": defaultOptions,
        "testTargets": testTargets,
        "version": 1
    }
    return JSON.stringify(testPlan).replace(/~/g, '\\/');
}

function shard(arr, howMany) {
    let newArr = []; start = 0; end = howMany;
    for (let i = 1; i <= SHARDS; i++) {
        newArr.push(arr.slice(start, end));
        start = start + howMany;
        end = (i == (SHARDS - 1) ? arr.length : end + howMany);
    }
    return newArr;
}

function log(msg, obj) {
    if (DEBUG) {
        console.log(msg, obj ? obj : '');
    }
}

function getRecursiveTests(myProj, target_uuid, tests = []) {
    const target = myProj.getPBXGroupByKey(target_uuid);
    // log('Checking=====:', target_uuid)
    if (target && target.children && target.children.length > 0) {
        target.children.forEach((test) => {
            if (test && test.comment && (test.comment.indexOf('UITests.swift') != -1)) {
                tests.push(test);
            } else {
                return getRecursiveTests(myProj, test.value, tests)
            }
        })
        return tests;
    } else {
        return tests;
    }
}
