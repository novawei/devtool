# devtool

Tomcat和Java的开发辅助工具

本人想用vscode开发Java，但是vscode Tomcat的配置和启动并不是很方便，所以自己写了个工具用来简化Tomcat的部署

项目打包jar和war需要自己配置maven，本工具不包含打包功能

## devcnf.yml

在项目根目录下配置devcnf.yml文件

devcnf.yml配置例子
```yml
tomcatPath: /Applications/apache-tomcat-8.5.45
tomcatList:
  - name: base
    vmOptions: -server -Xms256m -Xmx512m
    ports:
      server: 8006
      http: 8081
      ajp: 8010
      redirect: 8444
    webapps:
      - dfs: sf-dfs--web
      - uc: sf-uc-web
  - name: service
    vmOptions: -server -Xms256m -Xmx512m
    ports:
      server: 8007
      http: 8082
      ajp: 8011
      redirect: 8445
    webapps:
      - gift: sf-gift-service-web
  - name: app
    vmOptions: -server -Xms256m -Xmx512m
    webapps:
      - web: sf-web
```

## devtool 命令

```shell
# 初始化Tomcat服务器
# 1.拷贝tomcat-path到.devtool/tomcat-xxx
# 2.配置server.xml，修改端口
# 3.配置vm options(JAVA_OPTS)
# 4.脚本添加执行权限
devtool init

# start Tomcat 
# xxx 为 yml中配置的name
devtool start xxx

# stop Tomcat
devtool stop xxx

# restart Tomcat
devtool restart xxx

# deploy webapps to Tomcat xxx
# 从yml webapps 列表中拷贝文件夹到 Tomcat webapps目录下
devtool deploy xxx
```